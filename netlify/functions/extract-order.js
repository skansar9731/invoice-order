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

    const candidateModels = [
      'gemini-3.6-flash',
      'gemini-2.5-flash',
      'gemini-2.0-flash',
      'gemini-1.5-flash'
    ];

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

    let geminiData = null;
    let lastError = 'No response from AI model';

    // Model and schema fallback loop
    for (const model of candidateModels) {
      const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;

      // Try 1: Structured schema
      try {
        const response = await fetch(geminiUrl, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-goog-api-key': apiKey
          },
          body: JSON.stringify(geminiBodyWithSchema)
        });

        if (response.ok) {
          geminiData = await response.json();
          break;
        } else {
          const errText = await response.text();
          let msg = `API error (${response.status})`;
          try {
            const errObj = JSON.parse(errText);
            msg = errObj.error?.message || msg;
          } catch (e) {}
          lastError = `${model}: ${msg}`;

          // If 400 Bad Request, try plain JSON mode on the same model
          if (response.status === 400) {
            try {
              const plainResp = await fetch(geminiUrl, {
                method: 'POST',
                headers: {
                  'Content-Type': 'application/json',
                  'x-goog-api-key': apiKey
                },
                body: JSON.stringify(geminiBodyPlainJson)
              });
              if (plainResp.ok) {
                geminiData = await plainResp.json();
                break;
              }
            } catch (pErr) {}
          }
        }
      } catch (fetchErr) {
        lastError = `${model}: ${fetchErr.message}`;
      }
    }

    if (!geminiData) {
      return {
        statusCode: 502,
        headers,
        body: JSON.stringify({ error: lastError })
      };
    }

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
      if (!row) continue;
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
