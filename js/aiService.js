/**
 * AI Service Abstraction Layer
 * Accepts image File objects and connects to Netlify serverless function (Gemini Vision API)
 */

// Configuration store in localStorage for user preferences
const AI_CONFIG_KEY = 'maharashtra_ai_config';

export function getAIConfig() {
  try {
    if (typeof window !== 'undefined' && window.localStorage) {
      const raw = window.localStorage.getItem(AI_CONFIG_KEY);
      if (raw) return JSON.parse(raw);
    }
  } catch (e) {
    console.warn('Failed to read AI config from localStorage', e);
  }

  return {
    mode: 'netlify', // 'netlify' | 'unconnected'
    netlifyEndpoint: '/.netlify/functions/extract-order'
  };
}

export function saveAIConfig(config) {
  try {
    if (typeof window !== 'undefined' && window.localStorage) {
      window.localStorage.setItem(AI_CONFIG_KEY, JSON.stringify(config));
    }
  } catch (e) {
    console.error('Failed to save AI config', e);
  }
}

/**
 * Check current AI connection status
 */
export function getAIStatus() {
  const config = getAIConfig();
  if (config.mode === 'netlify' && config.netlifyEndpoint) {
    return {
      connected: false, // will be confirmed when endpoint responds successfully with Gemini
      configured: true,
      mode: 'netlify',
      label: 'AI Status: Ready (Netlify)',
      endpoint: config.netlifyEndpoint
    };
  }
  return {
    connected: false,
    configured: false,
    mode: 'unconnected',
    label: 'AI Status: Not Connected',
    endpoint: ''
  };
}

/**
 * Validate AI extracted items schema
 * Ensures returned payload strictly matches [{ customerText: string, quantity: number }]
 */
export function validateAIExtraction(data) {
  if (!Array.isArray(data)) {
    throw new Error('AI extraction did not return an array of items.');
  }

  if (data.length === 0) {
    throw new Error('No readable order items were detected in the image.');
  }

  const validated = [];

  for (let i = 0; i < data.length; i++) {
    const row = data[i];
    const customerText = String(row.customerText || row.item || row.name || '').trim();
    const quantity = Math.max(1, parseInt(row.quantity || row.qty || 1, 10));

    if (customerText.length > 0) {
      validated.push({
        customerText,
        quantity
      });
    }
  }

  if (validated.length === 0) {
    throw new Error('Could not parse any valid product names from the handwriting image.');
  }

  return validated;
}

/**
 * Convert File object to Base64 data URL
 */
export function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = error => reject(error);
    reader.readAsDataURL(file);
  });
}

/**
 * Extract Order Items from Handwritten Image
 * Accepts the actual uploaded image File/Blob/base64 object.
 * Sends image to Netlify serverless function connected to Gemini Vision API.
 * NO HARDCODED OR FAKE DEMO ITEMS ARE RETURNED.
 * @param {File|Blob|string} imageInput - Image File or Base64 string
 * @param {Object} options - Override options
 * @returns {Promise<Array<{customerText: string, quantity: number}>>}
 */
export async function extractOrderFromImage(imageInput, options = {}) {
  const config = getAIConfig();
  const endpoint = options.endpoint || config.netlifyEndpoint || '/.netlify/functions/extract-order';

  if (!imageInput) {
    throw new Error('No image file was provided for extraction.');
  }

  // Convert File / Blob to Base64
  let base64Image = '';
  if (typeof imageInput === 'string') {
    base64Image = imageInput;
  } else if (imageInput instanceof File || imageInput instanceof Blob) {
    base64Image = await fileToBase64(imageInput);
  } else {
    throw new Error('Invalid image input format. Expected File or Base64.');
  }

  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        image: base64Image
      })
    });

    if (!response.ok) {
      const errBody = await response.json().catch(() => ({}));
      if (response.status === 404 || response.status === 500) {
        throw new Error(errBody.error || 'AI handwriting extraction is not connected yet. Connect Gemini API in Netlify to process this image.');
      }
      throw new Error(errBody.error || `AI extraction server error (${response.status})`);
    }

    const result = await response.json();
    return validateAIExtraction(result.items || result);
  } catch (err) {
    // If running in local development without netlify serverless functions active:
    if (err.message && err.message.includes('Failed to fetch')) {
      throw new Error('AI handwriting extraction is not connected. (Netlify / Gemini API endpoint not reachable). Please add items manually or configure Gemini in the next step.');
    }
    throw err;
  }
}

