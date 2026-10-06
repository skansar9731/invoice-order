/**
 * Netlify Serverless Function: AI Handwritten Order Extraction
 * Powered by Google Gemini Vision API
 * Dynamically queries available models for the configured API key via ListModels
 * Transcribes customer order slips into structured JSON: [{ partNumber, itemDescription, customerText, quantity }]
 */

// In-memory cache across warm serverless invocations
let cachedWorkingModel = null;
let cachedApiVersion = 'v1beta';
let cachedModelDiscovery = null;
let lastModelDiscoveryTime = 0;
const MODEL_CACHE_TTL = 10 * 60 * 1000; // 10 minutes

/**
 * Preferred production Flash models for Image-to-Order in deterministic priority order
 */
const PREFERRED_PRODUCTION_MODELS = [
  'gemini-3.8-flash',
  'gemini-3.7-flash',
  'gemini-3.6-flash',
  'gemini-3.5-flash',
  'gemini-3.5-flash-lite',
  'gemini-2.5-flash'
];

/**
 * Fallback static list of candidate models in order of capability & speed
 * (Used ONLY if dynamic ListModels discovery is unreachable)
 */
const STATIC_CANDIDATE_MODELS = [...PREFERRED_PRODUCTION_MODELS];

/**
 * Models that are NOT designed for standard Image Input -> Text/JSON extraction
 * (video gen, image gen, audio, tts, omni diffusion, embeddings)
 */
const EXCLUDED_MODEL_PATTERN = /omni|video|veo|image|imagen|banana|tts|speech|transcribe|audio|live|realtime|embed|embedding/i;

/**
 * Validate if a model returned by ListModels is eligible for image-to-order JSON extraction
 */
function isEligibleImageModel(m) {
  const modelId = (m.name || '').replace(/^models\//, '').trim();
  const methods = Array.isArray(m.supportedGenerationMethods) ? m.supportedGenerationMethods : [];
  const hasGenerateContent = methods.includes('generateContent');

  // Input modalities check if available in API response
  const modalities = m.inputModalities || m.supportedInputModalities || null;
  const supportsImage = Array.isArray(modalities)
    ? modalities.map(x => String(x).toLowerCase()).includes('image')
    : true; // Default true if field not present, unless excluded by name pattern

  // Check for explicit zero quota if reported in model metadata
  const hasZeroLimit = m.quotaLimit === 0 || m.limit === 0 || (m.quota && m.quota.limit === 0);

  // Blacklist check
  const isExcluded = EXCLUDED_MODEL_PATTERN.test(modelId);

  // Diagnostic logging (Requirement 8)
  console.log(`[AI Model Discovery] Model: "${modelId}" | Supported Methods: [${methods.join(', ')}] | Modalities: ${modalities ? JSON.stringify(modalities) : 'N/A'} | Supports generateContent: ${hasGenerateContent} | Supports Image: ${supportsImage} | Excluded: ${isExcluded} | ZeroLimit: ${hasZeroLimit}`);

  if (!hasGenerateContent) return false;
  if (!supportsImage) return false;
  if (isExcluded) return false;
  if (hasZeroLimit) return false;

  return true;
}

/**
 * Discover available models supporting generateContent for this API key via ListModels
 */
async function discoverAvailableModels(apiKey) {
  const now = Date.now();
  if (cachedModelDiscovery && (now - lastModelDiscoveryTime) < MODEL_CACHE_TTL) {
    return cachedModelDiscovery;
  }

  const versions = ['v1beta', 'v1'];
  for (const ver of versions) {
    try {
      const url = `https://generativelanguage.googleapis.com/${ver}/models?key=${encodeURIComponent(apiKey)}`;
      const res = await fetch(url, {
        method: 'GET',
        headers: {
          'x-goog-api-key': apiKey
        }
      });

      if (res.ok) {
        const data = await res.json();
        if (data && Array.isArray(data.models)) {
          // Strictly filter for eligible image models (excludes omni, video, tts, zero limit, etc.)
          const eligibleModels = data.models
            .filter(isEligibleImageModel)
            .map(m => (m.name || '').replace(/^models\//, '').trim())
            .filter(Boolean);

          if (eligibleModels.length > 0) {
            // Deterministic stable model priority (Requirements 4 & 9)
            // Strictly rank according to PREFERRED_PRODUCTION_MODELS
            eligibleModels.sort((a, b) => {
              const idxA = PREFERRED_PRODUCTION_MODELS.indexOf(a);
              const idxB = PREFERRED_PRODUCTION_MODELS.indexOf(b);

              if (idxA !== -1 && idxB !== -1) return idxA - idxB;
              if (idxA !== -1) return -1;
              if (idxB !== -1) return 1;

              return b.localeCompare(a, undefined, { numeric: true });
            });

            console.log(`[AI Model Discovery] Final ranked candidate models for execution:`, eligibleModels);

            cachedModelDiscovery = { models: eligibleModels, apiVersion: ver };
            lastModelDiscoveryTime = now;
            return cachedModelDiscovery;
          }
        }
      }
    } catch (err) {
      console.warn(`Model discovery failed on ${ver}:`, err.message);
    }
  }

  return null;
}

exports.handler = async (event, context) => {
  // CORS Headers
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Content-Type': 'application/json'
  };

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers, body: '' };
  }

  if (event.httpMethod !== 'POST') {
    return {
      statusCode: 405,
      headers,
      body: JSON.stringify({ error: 'Method Not Allowed. Use POST.' })
    };
  }

  const rawKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY;
  const apiKey = rawKey ? rawKey.trim().replace(/^['"]|['"]$/g, '').trim() : '';

  if (!apiKey) {
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({
        error: 'GEMINI_API_KEY environment variable is not configured on Netlify.',
        hint: 'Go to Netlify Dashboard -> Site Configuration -> Environment Variables -> Add GEMINI_API_KEY.'
      })
    };
  }

  try {
    const payload = JSON.parse(event.body || '{}');
    const imageBase64 = payload.image;

    if (!imageBase64) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ error: 'Missing "image" in request body.' })
      };
    }

    // Extract mime type and clean base64 data
    const match = imageBase64.match(/^data:([^;]+);base64,(.+)$/);
    const mimeType = match ? match[1] : 'image/jpeg';
    const data = match ? match[2] : imageBase64;

    const systemPrompt = `You are an expert automobile spare-parts order reader (skilled in reading handwritten order slips, workshop notes, and printed tables).

Read the uploaded customer order image carefully.

Extract EVERY distinct spare-part item visible in the order and its requested quantity.

The order may contain columns or headers such as:
- PART NAME / ITEM DESCRIPTION / PARTICULARS / PRODUCT
- PART NUMBER / PART NO / PART NO. / PART # / PART CODE / ITEM CODE / CODE / MODEL NO
- QTY / QUANTITY / PIS / PCS / NOS
or it may be handwritten lines without clear column headers.

FOR EVERY DISTINCT ORDER LINE, EXTRACT:
1. "customerText": The complete text of this line as written on the slip (e.g. "karbon brush 31201KG8004 5", "MITER ASSLY 37100AAE3109S 1", "SAID STAND KIT 2").
2. "partNumber": If a Part Number, OEM Code, or Model Code is visible (in a column or written next to the item), extract it exactly (e.g. "31201KG8004", "95014723025", "77300AAE300RS", "37100AAE3109S", "35100AAE301S"). Preserve all letters, numbers, hyphens, and slashes. If no Part Number is written or visible for this line, return "". Do not invent fake part numbers.
3. "itemDescription": The part name or item description (e.g. "karbon brush", "SAID STAND SPRING", "CALL SET", "MITER ASSLY", "KEY SINGEL", "SAID STAND KIT").
4. "quantity": The requested quantity as an integer. If clearly written, use that quantity. If genuinely not visible, use 1.

HANDWRITING & SLIP TOLERANCE:
The customer may use:
- spelling mistakes, abbreviations, short forms (e.g. SPL, BS6, Pro, Dlx, Shine, Splendor, Passion, Teming, Bor kit, Clutch Assy)
- local automotive slang

Do not skip an item merely because the handwriting is unclear.
If a handwritten line is partially unclear, return your best transcription of the visible characters/words instead of omitting the line.
Never invent completely unrelated products.
Read ALL visible order lines from top to bottom.
Ignore printed logos, signatures, and decorative borders.
Return ONLY a valid JSON array.`;

    // Discover live models for this API key
    const discovery = await discoverAvailableModels(apiKey);
    let candidateModels = [];

    if (discovery && discovery.models.length > 0) {
      candidateModels = [...discovery.models];
    } else {
      candidateModels = [...STATIC_CANDIDATE_MODELS];
    }

    // Strict safety filter: ensure no excluded models ever enter execution
    candidateModels = candidateModels.filter(m => !EXCLUDED_MODEL_PATTERN.test(m));
    if (candidateModels.length === 0) {
      candidateModels = [...STATIC_CANDIDATE_MODELS];
    }

    // If we have a cached working model, prioritize it first (strictly if not excluded)
    if (cachedWorkingModel && !EXCLUDED_MODEL_PATTERN.test(cachedWorkingModel)) {
      candidateModels = [
        cachedWorkingModel,
        ...candidateModels.filter(m => m !== cachedWorkingModel)
      ];
    }

    const geminiBodyWithSchema = {
      contents: [
        {
          parts: [
            { text: systemPrompt },
            {
              inline_data: {
                mime_type: mimeType,
                data: data
              }
            }
          ]
        }
      ],
      generationConfig: {
        response_mime_type: 'application/json',
        response_schema: {
          type: 'ARRAY',
          items: {
            type: 'OBJECT',
            properties: {
              customerText: { type: 'STRING' },
              itemDescription: { type: 'STRING' },
              partNumber: { type: 'STRING' },
              quantity: { type: 'INTEGER' }
            },
            required: ['customerText', 'quantity']
          }
        }
      }
    };

    const geminiBodyPlainJson = {
      contents: [
        {
          parts: [
            { text: `${systemPrompt}\n\nIMPORTANT: Return a JSON array of objects with keys: customerText, itemDescription, partNumber, quantity.` },
            {
              inline_data: {
                mime_type: mimeType,
                data: data
              }
            }
          ]
        }
      ],
      generationConfig: {
        response_mime_type: 'application/json'
      }
    };

    const geminiBodyRaw = {
      contents: [
        {
          parts: [
            { text: `${systemPrompt}\n\nIMPORTANT: Return ONLY a raw JSON array of objects: [{"customerText": "...", "itemDescription": "...", "partNumber": "...", "quantity": 1}]. No markdown code blocks, no explanations.` },
            {
              inline_data: {
                mime_type: mimeType,
                data: data
              }
            }
          ]
        }
      ]
    };

    let geminiData = null;
    let lastError = 'No response from AI model';
    const apiVer = discovery?.apiVersion || cachedApiVersion || 'v1beta';

    for (const model of candidateModels) {
      const geminiUrl = `https://generativelanguage.googleapis.com/${apiVer}/models/${model}:generateContent`;

      try {
        // Attempt 1: Structured schema
        const resp1 = await fetch(geminiUrl, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-goog-api-key': apiKey
          },
          body: JSON.stringify(geminiBodyWithSchema)
        });

        if (resp1.ok) {
          geminiData = await resp1.json();
          cachedWorkingModel = model;
          cachedApiVersion = apiVer;
          break;
        }

        const errText1 = await resp1.text();
        let errMsg1 = `Status ${resp1.status}`;
        try {
          const errObj = JSON.parse(errText1);
          errMsg1 = errObj.error?.message || errMsg1;
        } catch (e) {}

        // Rate limit / Quota exceeded
        if (resp1.status === 429) {
          // If limit: 0 for this specific model, this model has no quota on this tier/key; continue to next candidate model
          if (errMsg1.toLowerCase().includes('limit: 0') || errMsg1.toLowerCase().includes('limit:0')) {
            console.warn(`[AI Extraction] Model "${model}" returned limit: 0 on this key. Trying next candidate.`);
            lastError = `${model}: Quota limit 0`;
            continue;
          }
          return {
            statusCode: 429,
            headers,
            body: JSON.stringify({
              error: `Google Gemini API rate limit or quota exceeded: ${errMsg1}. Please check your Google AI Studio plan or try again shortly.`
            })
          };
        }

        // Invalid key / Forbidden
        if (resp1.status === 401 || resp1.status === 403) {
          return {
            statusCode: resp1.status,
            headers,
            body: JSON.stringify({
              error: `Google Gemini API authorization failed (${errMsg1}). Please verify GEMINI_API_KEY in Netlify settings.`
            })
          };
        }

        // Attempt 2: If 400 Bad Request (schema or formatting issue), try plain JSON mode
        if (resp1.status === 400) {
          try {
            const resp2 = await fetch(geminiUrl, {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                'x-goog-api-key': apiKey
              },
              body: JSON.stringify(geminiBodyPlainJson)
            });

            if (resp2.ok) {
              geminiData = await resp2.json();
              cachedWorkingModel = model;
              cachedApiVersion = apiVer;
              break;
            }

            // Attempt 3: Try raw mode without generationConfig
            const resp3 = await fetch(geminiUrl, {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                'x-goog-api-key': apiKey
              },
              body: JSON.stringify(geminiBodyRaw)
            });

            if (resp3.ok) {
              geminiData = await resp3.json();
              cachedWorkingModel = model;
              cachedApiVersion = apiVer;
              break;
            }
          } catch (modeErr) {}
        }

        lastError = `${model}: ${errMsg1}`;
      } catch (fetchErr) {
        lastError = `${model}: ${fetchErr.message}`;
      }
    }

    if (!geminiData) {
      return {
        statusCode: 502,
        headers,
        body: JSON.stringify({
          error: `Gemini API call failed: ${lastError}`,
          hint: 'Please ensure your Gemini API key has access to vision models in Google AI Studio.'
        })
      };
    }

    const candidate = geminiData.candidates?.[0];
    const rawText = candidate?.content?.parts?.[0]?.text || '';

    if (!rawText) {
      const finishReason = candidate?.finishReason;
      const blockReason = geminiData.promptFeedback?.blockReason;
      return {
        statusCode: 502,
        headers,
        body: JSON.stringify({
          error: `AI returned empty response (Finish reason: ${finishReason || blockReason || 'Unknown'}). Please check image clarity.`
        })
      };
    }

    // Parse JSON
    let rawItems = [];
    try {
      const cleanJson = rawText.replace(/```json/gi, '').replace(/```/g, '').trim();
      rawItems = JSON.parse(cleanJson);
    } catch (parseErr) {
      // Substring array fallback
      const arrayMatch = rawText.match(/\[[\s\S]*\]/);
      if (arrayMatch) {
        try {
          rawItems = JSON.parse(arrayMatch[0]);
        } catch (e2) {}
      }
    }

    if (!Array.isArray(rawItems)) {
      if (rawItems && Array.isArray(rawItems.items)) {
        rawItems = rawItems.items;
      } else if (rawItems && typeof rawItems === 'object') {
        const arrKey = Object.keys(rawItems).find(k => Array.isArray(rawItems[k]));
        if (arrKey) rawItems = rawItems[arrKey];
        else rawItems = [rawItems];
      } else {
        rawItems = [];
      }
    }

    // Validate and clean extracted items
    const parsedItems = [];
    for (const row of rawItems) {
      if (!row || typeof row !== 'object') continue;
      const partNumber = String(row.partNumber || row.partNo || row.part_code || row.code || '').trim();
      const itemDescription = String(row.itemDescription || row.description || row.itemName || row.partName || row.name || '').trim();
      const customerText = String(row.customerText || '').trim();
      const quantity = Math.max(1, parseInt(row.quantity || row.qty || row.pis || row.pcs || 1, 10));

      let finalCustomerText = customerText;
      let finalDescription = itemDescription;

      if (!finalCustomerText) {
        if (finalDescription && partNumber) {
          finalCustomerText = `${finalDescription} ${partNumber}`;
        } else {
          finalCustomerText = finalDescription || partNumber;
        }
      }

      if (!finalDescription) {
        finalDescription = finalCustomerText;
      }

      if (finalCustomerText.length > 0 || finalDescription.length > 0 || partNumber.length > 0) {
        parsedItems.push({
          partNumber,
          itemDescription: finalDescription,
          customerText: finalCustomerText || finalDescription,
          quantity
        });
      }
    }

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        items: parsedItems,
        count: parsedItems.length
      })
    };
  } catch (err) {
    console.error('Serverless function error:', err);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: err.message || 'Internal Server Error' })
    };
  }
};
