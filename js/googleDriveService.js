/**
 * Google Drive & OAuth Integration Service
 * Manages Google Identity Services OAuth 2.0, Google Picker, and Google Drive REST API v3
 * for uploading sales order PDF and Excel entry sheets into "MH SALES ORDER".
 */

export const GOOGLE_DRIVE_ROOT_FOLDER_ID = '1oBMIcaBTYILseV39YnRuX1U_sO7vxFK';
export const GOOGLE_DRIVE_ROOT_FOLDER_NAME = 'MH SALES ORDER';
export const GOOGLE_OAUTH_CLIENT_ID = '504075948357-akcql7sb5hkiadlms9pkj371b38cv7p7.apps.googleusercontent.com';
export const GOOGLE_DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive.file';

const STORAGE_KEY_ROOT_FOLDER_ID = 'gdrive_root_folder_id';

let tokenClient = null;
let currentAccessToken = null;
let tokenExpiresAt = 0;
let isInitializing = null;

const MONTH_NAMES = [
  'JANUARY', 'FEBRUARY', 'MARCH', 'APRIL', 'MAY', 'JUNE',
  'JULY', 'AUGUST', 'SEPTEMBER', 'OCTOBER', 'NOVEMBER', 'DECEMBER'
];

/**
 * Dynamically load Google Identity Services and Google API scripts if not already present
 */
export async function loadGoogleScripts() {
  if (typeof document === 'undefined' || !document.querySelector) return;
  const loadScript = (src) => {
    return new Promise((resolve, reject) => {
      if (document.querySelector(`script[src="${src}"]`)) {
        resolve();
        return;
      }
      const script = document.createElement('script');
      script.src = src;
      script.async = true;
      script.defer = true;
      script.onload = () => resolve();
      script.onerror = () => reject(new Error(`Failed to load script: ${src}`));
      document.head.appendChild(script);
    });
  };

  const tasks = [];
  if (typeof window !== 'undefined') {
    if (!window.google?.accounts?.oauth2) {
      tasks.push(loadScript('https://accounts.google.com/gsi/client'));
    }
    if (!window.gapi) {
      tasks.push(loadScript('https://apis.google.com/js/api.js'));
    }
  }

  await Promise.all(tasks);
}

/**
 * Initialize Google Drive GIS Token Client and GAPI Picker
 */
export async function initializeGoogleDrive() {
  if (isInitializing) return isInitializing;

  isInitializing = (async () => {
    try {
      await loadGoogleScripts();

      if (window.google?.accounts?.oauth2 && !tokenClient) {
        tokenClient = window.google.accounts.oauth2.initTokenClient({
          client_id: GOOGLE_OAUTH_CLIENT_ID,
          scope: GOOGLE_DRIVE_SCOPE,
          callback: () => {} // Callback is set dynamically per request
        });
      }

      // Preload gapi picker module
      if (window.gapi && !window.google?.picker) {
        await new Promise((resolve) => {
          window.gapi.load('picker', { callback: resolve });
        });
      }

      return true;
    } catch (err) {
      console.warn('Google Drive initialization warning:', err.message);
      return false;
    }
  })();

  return isInitializing;
}

/**
 * Check if a valid, non-expired access token is active in memory
 */
export function isGoogleDriveAuthorized() {
  return Boolean(currentAccessToken && Date.now() < (tokenExpiresAt - 60000));
}

/**
 * Authorize with Google OAuth via Google Identity Services
 * Prompts user with GIS popup only if token is absent or expired
 */
export async function authorizeGoogleDrive(interactive = true) {
  if (isGoogleDriveAuthorized()) {
    return currentAccessToken;
  }

  await initializeGoogleDrive();

  if (!window.google?.accounts?.oauth2) {
    throw new Error('Google Identity Services library failed to load. Please verify your internet connection.');
  }

  if (!tokenClient) {
    tokenClient = window.google.accounts.oauth2.initTokenClient({
      client_id: GOOGLE_OAUTH_CLIENT_ID,
      scope: GOOGLE_DRIVE_SCOPE,
      callback: () => {}
    });
  }

  return new Promise((resolve, reject) => {
    tokenClient.callback = (resp) => {
      if (resp.error) {
        if (resp.error === 'access_denied') {
          reject(new Error('Google authorization was cancelled by user.'));
        } else {
          reject(new Error(`Google authorization failed: ${resp.error_description || resp.error}`));
        }
        return;
      }

      const expiresIn = Number(resp.expires_in) || 3600;
      currentAccessToken = resp.access_token;
      tokenExpiresAt = Date.now() + (expiresIn * 1000);
      resolve(currentAccessToken);
    };

    tokenClient.error_callback = (err) => {
      if (err?.type === 'popup_closed') {
        reject(new Error('Google authorization window was closed before completing.'));
      } else {
        reject(new Error(err?.message || 'Google authorization failed.'));
      }
    };

    tokenClient.requestAccessToken({ prompt: interactive ? '' : 'none' });
  });
}

/**
 * Show Google Picker for the user to select the existing "MH SALES ORDER" root folder.
 * Grants drive.file scope access to the selected folder and stores the ID locally.
 */
export async function selectDriveRootFolder() {
  const token = await authorizeGoogleDrive(true);

  if (!window.google?.picker) {
    await new Promise((resolve, reject) => {
      if (window.gapi) {
        window.gapi.load('picker', {
          callback: resolve,
          onerror: () => reject(new Error('Failed to load Google Picker library.'))
        });
      } else {
        reject(new Error('Google API Client (gapi) is not available.'));
      }
    });
  }

  return new Promise((resolve, reject) => {
    try {
      const view = new window.google.picker.DocsView(window.google.picker.ViewId.FOLDERS)
        .setIncludeFolders(true)
        .setSelectFolderEnabled(true)
        .setMimeTypes('application/vnd.google-apps.folder');

      const appId = GOOGLE_OAUTH_CLIENT_ID.split('-')[0];

      const pickerBuilder = new window.google.picker.PickerBuilder()
        .addView(view)
        .setOAuthToken(token)
        .setAppId(appId)
        .setTitle(`Select the "${GOOGLE_DRIVE_ROOT_FOLDER_NAME}" Folder`)
        .setCallback((data) => {
          if (data.action === window.google.picker.Action.PICKED) {
            const doc = data.docs?.[0];
            if (!doc) {
              reject(new Error('No folder was selected.'));
              return;
            }

            const selectedId = doc.id;
            const selectedName = (doc.name || '').trim();

            // Validate against expected folder name and ID
            const isNameMatch = selectedName.toUpperCase() === GOOGLE_DRIVE_ROOT_FOLDER_NAME.toUpperCase();
            const isIdMatch = selectedId === GOOGLE_DRIVE_ROOT_FOLDER_ID;

            if (!isNameMatch && !isIdMatch) {
              reject(new Error(
                `Invalid folder selected: "${selectedName}". Please select the designated "${GOOGLE_DRIVE_ROOT_FOLDER_NAME}" folder.`
              ));
              return;
            }

            // Successfully validated
            try {
              if (typeof localStorage !== 'undefined') {
                localStorage.setItem(STORAGE_KEY_ROOT_FOLDER_ID, selectedId);
              }
            } catch (e) {
              console.warn('Could not save folder ID to localStorage:', e);
            }

            resolve(selectedId);
          } else if (data.action === window.google.picker.Action.CANCEL) {
            reject(new Error('Folder selection was cancelled. Please authorize the "MH SALES ORDER" folder to export.'));
          }
        });

      const picker = pickerBuilder.build();
      picker.setVisible(true);
    } catch (err) {
      reject(new Error(`Could not open Google Picker: ${err.message}`));
    }
  });
}

/**
 * Validate accessibility of a folder ID via Google Drive REST API
 */
async function verifyFolderAccess(folderId, token) {
  try {
    const res = await fetch(`https://www.googleapis.com/drive/v3/files/${folderId}?fields=id,name,trashed,mimeType`, {
      headers: {
        Authorization: `Bearer ${token}`
      }
    });

    if (!res.ok) return false;
    const data = await res.json();
    if (data.trashed) return false;
    return true;
  } catch {
    return false;
  }
}

/**
 * Resolve the MH SALES ORDER root folder ID.
 * Reuses verified stored ID from localStorage or configured ID if already accessible.
 * Prompts Google Picker only on first-time setup or if access is lost.
 */
export async function resolveDriveRootFolder() {
  const token = await authorizeGoogleDrive(true);

  // 1. Check localStorage first
  let candidateId = null;
  try {
    if (typeof localStorage !== 'undefined') {
      candidateId = localStorage.getItem(STORAGE_KEY_ROOT_FOLDER_ID);
    }
  } catch (e) {
    console.warn('Unable to read localStorage:', e);
  }

  if (candidateId) {
    const hasAccess = await verifyFolderAccess(candidateId, token);
    if (hasAccess) return candidateId;
  }

  // 2. Check configured root folder directly
  const configuredAccess = await verifyFolderAccess(GOOGLE_DRIVE_ROOT_FOLDER_ID, token);
  if (configuredAccess) {
    try {
      if (typeof localStorage !== 'undefined') {
        localStorage.setItem(STORAGE_KEY_ROOT_FOLDER_ID, GOOGLE_DRIVE_ROOT_FOLDER_ID);
      }
    } catch {}
    return GOOGLE_DRIVE_ROOT_FOLDER_ID;
  }

  // 3. Prompt user via Google Picker to authorize the folder under drive.file scope
  const selectedId = await selectDriveRootFolder();
  return selectedId;
}

/**
 * Format month folder name from order date (or current date)
 * Output example: "SEPTEMBER 2026"
 */
export function getMonthFolderName(orderDate) {
  let year = null;
  let monthIndex = null;

  if (orderDate && typeof orderDate === 'string') {
    const parts = orderDate.split('-');
    if (parts.length >= 2) {
      const parsedYear = parseInt(parts[0], 10);
      const parsedMonth = parseInt(parts[1], 10) - 1;
      if (!isNaN(parsedYear) && parsedMonth >= 0 && parsedMonth < 12) {
        year = parsedYear;
        monthIndex = parsedMonth;
      }
    }
  }

  if (year === null || monthIndex === null) {
    const now = new Date();
    year = now.getFullYear();
    monthIndex = now.getMonth();
  }

  return `${MONTH_NAMES[monthIndex]} ${year}`;
}

/**
 * Find or create the month folder (e.g. "SEPTEMBER 2026") under MH SALES ORDER.
 * Guarantees no duplicate month folders.
 */
export async function getOrCreateMonthFolder(monthFolderName) {
  const token = await authorizeGoogleDrive(true);
  const rootId = await resolveDriveRootFolder();

  // 1. Search for existing month folder under root
  const query = `mimeType = 'application/vnd.google-apps.folder' and '${rootId}' in parents and name = '${monthFolderName.replace(/'/g, "\\'")}' and trashed = false`;
  const searchUrl = `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(query)}&fields=files(id,name)&spaces=drive`;

  const searchRes = await fetch(searchUrl, {
    headers: { Authorization: `Bearer ${token}` }
  });

  if (!searchRes.ok) {
    const errText = await searchRes.text();
    throw new Error(`Failed to query month folder: ${searchRes.status} ${errText}`);
  }

  const searchData = await searchRes.json();
  if (searchData.files && searchData.files.length > 0) {
    return searchData.files[0].id;
  }

  // 2. Create month folder if not found
  const createRes = await fetch('https://www.googleapis.com/drive/v3/files?fields=id,name', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      name: monthFolderName,
      mimeType: 'application/vnd.google-apps.folder',
      parents: [rootId]
    })
  });

  if (!createRes.ok) {
    const errText = await createRes.text();
    throw new Error(`Failed to create month folder "${monthFolderName}": ${createRes.status} ${errText}`);
  }

  const createdData = await createRes.json();
  return createdData.id;
}

/**
 * Upload a new file or update existing file in place to avoid duplicates
 * @param {Object} params
 * @param {string} params.filename - Desired filename (e.g. "ORD-260912-001_Busy_Entry_Sheet.pdf")
 * @param {string} params.mimeType - MIME type of file
 * @param {Blob} params.blob - Binary Blob content
 * @param {string} [params.orderDate] - Order date for dynamic month resolution
 * @returns {Promise<{ fileId: string, filename: string, webViewLink: string, monthFolderName: string }>}
 */
export async function uploadOrUpdateDriveFile({ filename, mimeType, blob, orderDate }) {
  if (!blob) throw new Error('Cannot upload empty file blob.');
  if (!filename) throw new Error('Filename is required for upload.');

  const token = await authorizeGoogleDrive(true);
  const monthFolderName = getMonthFolderName(orderDate);
  const monthFolderId = await getOrCreateMonthFolder(monthFolderName);

  // 1. Check if a file with the exact same name already exists in the month folder
  const query = `'${monthFolderId}' in parents and name = '${filename.replace(/'/g, "\\'")}' and trashed = false`;
  const searchUrl = `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(query)}&fields=files(id,name,webViewLink)&spaces=drive`;

  const searchRes = await fetch(searchUrl, {
    headers: { Authorization: `Bearer ${token}` }
  });

  if (!searchRes.ok) {
    const errText = await searchRes.text();
    throw new Error(`Drive file search error: ${searchRes.status} ${errText}`);
  }

  const searchData = await searchRes.json();
  const existingFile = searchData.files && searchData.files.length > 0 ? searchData.files[0] : null;

  let resultFile = null;

  if (existingFile) {
    // 2. UPDATE existing file in-place (No duplicate created)
    const updateUrl = `https://www.googleapis.com/upload/drive/v3/files/${existingFile.id}?uploadType=media&fields=id,name,webViewLink`;
    const updateRes = await fetch(updateUrl, {
      method: 'PATCH',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': mimeType
      },
      body: blob
    });

    if (!updateRes.ok) {
      const errText = await updateRes.text();
      throw new Error(`Drive file update error: ${updateRes.status} ${errText}`);
    }

    resultFile = await updateRes.json();
  } else {
    // 3. CREATE new file via multipart upload
    const boundary = '-------mh_sales_order_upload_boundary_' + Date.now();
    const delimiter = `\r\n--${boundary}\r\n`;
    const closeDelimiter = `\r\n--${boundary}--`;

    const metadata = {
      name: filename,
      mimeType: mimeType,
      parents: [monthFolderId]
    };

    const metadataPart = delimiter +
      'Content-Type: application/json; charset=UTF-8\r\n\r\n' +
      JSON.stringify(metadata) +
      delimiter +
      `Content-Type: ${mimeType}\r\n\r\n`;

    const multipartBlob = new Blob([metadataPart, blob, closeDelimiter], {
      type: `multipart/related; boundary=${boundary}`
    });

    const uploadUrl = 'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,name,webViewLink';
    const uploadRes = await fetch(uploadUrl, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`
      },
      body: multipartBlob
    });

    if (!uploadRes.ok) {
      const errText = await uploadRes.text();
      throw new Error(`Drive file upload error: ${uploadRes.status} ${errText}`);
    }

    resultFile = await uploadRes.json();
  }

  const webViewLink = resultFile.webViewLink || `https://drive.google.com/file/d/${resultFile.id}/view?usp=drivesdk`;

  return {
    fileId: resultFile.id,
    filename: resultFile.name || filename,
    webViewLink: webViewLink,
    monthFolderName: monthFolderName,
    isUpdate: Boolean(existingFile)
  };
}

/**
 * Open the uploaded Drive file in the pre-opened blank window or fallback gracefully
 */
export function openDriveFile(webViewLink, popupWindow = null) {
  if (popupWindow && !popupWindow.closed) {
    try {
      popupWindow.location.href = webViewLink;
      return true;
    } catch {
      // Cross-origin redirection edge case
    }
  }

  // Attempt window.open if popup wasn't provided or closed
  try {
    const fallback = window.open(webViewLink, '_blank');
    if (fallback) return true;
  } catch {}

  return false;
}
