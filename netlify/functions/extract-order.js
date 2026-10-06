/**
 * Netlify Serverless Function: AI Handwritten Order Extraction
 * Powered by Google Gemini 3.6 Flash Vision API
 * Transcribes handwritten customer order slips into structured JSON: [{ customerText, quantity }]
 */

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

  const apiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY;

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

    const systemPrompt = `You are an expert automobile spare-parts order reader (extracting from handwritten slips, printed tables, and order images).

Read the uploaded customer order image carefully.

CRITICAL FIELD EXTRACTION RULES:
For every distinct spare-part item visible in the order, extract these fields:

1. "partNumber":
   - Identify columns, labels, or codes such as:
     PART NUMBER, PART NO, PART NO., PART #, PART CODE, ITEM CODE, CODE, MODEL NO
     or equivalent layouts.
   - Do NOT assume a fixed column position. Look across the columns/headers.
   - Extract the exact alphanumeric Part Number / Code (e.g. "31201KG8004", "95014723025", "77300AAE300RS", "37100AAE3109S", "35100AAE301S").
   - Preserve all letters, numbers, hyphens, and slashes exactly.
   - If no Part Number is written or readable for this line, return empty string "".
   - Never invent or fabricate Part Numbers.

2. "itemDescription":
   - Extract the Part Name / Item Description (e.g. "karbon brush", "SAID STAND SPRING", "CALL SET", "MITER ASSLY", "KEY SINGEL", "SAID STAND KIT").
   - Preserve customer's spelling, abbreviations, and wording as closely as possible.
   - Customer may use short forms: SPL, BS6, Pro, Dlx, Shine, Splendor, Passion, Teming, Bor kit, etc.

3. "quantity":
   - Extract the quantity from columns/labels such as: QTY, QUANTITY, PIS, PCS, NOS, etc.
   - If quantity is clearly written (e.g. 1, 2, 5, 10), return that integer.
   - If quantity is genuinely not visible, default to 1.

4. "customerText":
   - Full raw text line for this item (e.g. "karbon brush 31201KG8004" or "SAID STAND KIT").

CRITICAL FORMAT RULES:
- Read ALL visible order lines in sequence from top to bottom.
- If there are 5 items, return 5 items. If there are 10 items, return 10 items.
- Ignore printed company logos, decorative borders, stamps, and signatures.
- Return ONLY valid JSON adhering strictly to the schema.`;

    // Call Gemini 3.6 Flash API via REST with x-goog-api-key header
    const geminiUrl = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-3.6-flash:generateContent';

    const geminiBody = {
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
              partNumber: { type: 'STRING' },
              itemDescription: { type: 'STRING' },
              quantity: { type: 'INTEGER' },
              customerText: { type: 'STRING' }
            },
            required: ['partNumber', 'itemDescription', 'quantity']
          }
        }
      }
    };

    const response = await fetch(geminiUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-goog-api-key': apiKey
      },
      body: JSON.stringify(geminiBody)
    });

    if (!response.ok) {
      const errText = await response.text();
      let safeMsg = 'Gemini API call failed';
      try {
        const errObj = JSON.parse(errText);
        safeMsg = errObj.error?.message || safeMsg;
      } catch (e) {
        safeMsg = `Gemini API error (${response.status})`;
      }
      return {
        statusCode: response.status,
        headers,
        body: JSON.stringify({ error: safeMsg })
      };
    }

    const geminiData = await response.json();
    const rawText = geminiData.candidates?.[0]?.content?.parts?.[0]?.text || '[]';

    // Parse JSON
    let rawItems = [];
    try {
      const cleanJson = rawText.replace(/```json/gi, '').replace(/```/g, '').trim();
      rawItems = JSON.parse(cleanJson);
    } catch (parseErr) {
      console.error('Failed to parse Gemini output:', rawText);
      return {
        statusCode: 502,
        headers,
        body: JSON.stringify({
          error: 'Failed to parse structured JSON from Gemini output.',
          raw: rawText
        })
      };
    }

    if (!Array.isArray(rawItems)) {
      if (rawItems && Array.isArray(rawItems.items)) {
        rawItems = rawItems.items;
      } else {
        rawItems = [];
      }
    }

    // Validate and clean extracted items
    const parsedItems = [];
    for (const row of rawItems) {
      if (!row) continue;
      const partNumber = String(row.partNumber || row.partNo || row.part_code || row.code || '').trim();
      const itemDescription = String(row.itemDescription || row.description || row.itemName || row.partName || row.name || '').trim();
      const quantity = Math.max(1, parseInt(row.quantity || row.qty || row.pis || row.pcs || 1, 10));

      let customerText = String(row.customerText || '').trim();
      if (!customerText) {
        if (itemDescription && partNumber) {
          customerText = `${itemDescription} ${partNumber}`;
        } else {
          customerText = itemDescription || partNumber;
        }
      }

      const finalDescription = itemDescription || customerText;

      if (finalDescription.length > 0 || partNumber.length > 0) {
        parsedItems.push({
          partNumber,
          itemDescription: finalDescription,
          customerText: customerText || finalDescription,
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
