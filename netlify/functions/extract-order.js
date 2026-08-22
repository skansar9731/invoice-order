/**
 * Netlify Serverless Function: AI Handwritten Order Extraction
 * Powered by Google Gemini 2.5 Flash Vision API
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

    const systemPrompt = `You are an expert handwritten automobile spare-parts order reader.

Read the uploaded customer order image carefully.

Extract EVERY distinct spare-part item visible in the handwritten order and its requested quantity.

Preserve the customer's wording as closely as possible.

The customer may use:
- spelling mistakes
- abbreviations
- short forms
- local terminology
- automobile terminology
- model names
- incomplete words

Examples:
Teming
Timing
Bor kit
Clutch Assy
SPL
BS6
Pro
Dlx
Shine
Splendor
Passion

Do not skip an item merely because the handwriting is unclear.

If a handwritten line is partially unclear, return your best transcription of the visible characters/words instead of omitting the line.

Never invent a completely unrelated product.

Do not invent Part Numbers.

Do not invent Rack.

Do not invent Stock.

Do not invent Unit.

Read ALL visible handwritten order lines.

If there are 5 items, return 5 items.
If there are 10 items, return 10 items.

If quantity is clearly written, use that quantity.

If quantity is genuinely not visible, use quantity 1.

Ignore printed logos, signatures, decorative borders and unrelated printed text.

Return ONLY JSON.`;

    // Call Gemini 2.5 Flash API via REST with x-goog-api-key header
    const geminiUrl = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent';

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
        temperature: 0.1,
        response_mime_type: 'application/json',
        response_schema: {
          type: 'ARRAY',
          items: {
            type: 'OBJECT',
            properties: {
              customerText: { type: 'STRING' },
              quantity: { type: 'INTEGER' }
            },
            required: ['customerText', 'quantity']
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
      const customerText = String(row.customerText || row.item || row.name || '').trim();
      const quantity = Math.max(1, parseInt(row.quantity || row.qty || 1, 10));

      if (customerText.length > 0) {
        parsedItems.push({
          customerText,
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
