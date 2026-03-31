const path = require("path");
const { google } = require("googleapis");

const familyImages = [
  {
    family: "Jain Family",
    images: [
      {
        url: "https://images.unsplash.com/photo-1593113598332-cd59a93f7d6c?auto=format&fit=crop&w=800&q=80",
        name: "Jain1",
      },
      {
        url: "https://images.unsplash.com/photo-1511988617509-a57c8a288659?auto=format&fit=crop&w=800&q=80",
        name: "Jain2",
      },
    ],
  },
  {
    family: "Sharma Family",
    images: [
      {
        url: "https://images.unsplash.com/photo-1551884170-09fb70a3a2ed?auto=format&fit=crop&w=800&q=80",
        name: "Sharma1",
      },
      {
        url: "https://images.unsplash.com/photo-1469571486292-b53601020a87?auto=format&fit=crop&w=800&q=80",
        name: "Sharma2",
      },
    ],
  },
  {
    family: "Gupta Family",
    images: [
      {
        url: "https://images.unsplash.com/photo-1478131143081-80f7f84ca84d?auto=format&fit=crop&w=800&q=80",
        name: "Gupta1",
      },
      {
        url: "https://images.unsplash.com/photo-1519741497674-611481863552?auto=format&fit=crop&w=800&q=80",
        name: "Gupta2",
      },
    ],
  },
];

function getImages(req, res) {
  return res.json(familyImages);
}

async function getFolders(req, res) {
  console.log("[GET /get-folders] Request started");

  const keyFileFromEnv = process.env.GOOGLE_SERVICE_ACCOUNT_KEY;
  const parentFolderId = process.env.DRIVE_FOLDER_ID;

  console.log("[GET /get-folders] DRIVE_FOLDER_ID:", parentFolderId || "<missing>");

  if (!keyFileFromEnv) {
    return res.status(500).json({
      success: false,
      error: "GOOGLE_SERVICE_ACCOUNT_KEY is missing",
    });
  }

  if (!parentFolderId) {
    return res.status(500).json({
      success: false,
      error: "DRIVE_FOLDER_ID is missing",
    });
  }

  const keyFilePath = path.isAbsolute(keyFileFromEnv)
    ? keyFileFromEnv
    : path.resolve(process.cwd(), keyFileFromEnv);

  try {
    const auth = new google.auth.GoogleAuth({
      keyFile: keyFilePath,
      scopes: ["https://www.googleapis.com/auth/drive.readonly"],
    });

    const drive = google.drive({ version: "v3", auth });
    const parentQuery = "'" + parentFolderId + "' in parents and mimeType='application/vnd.google-apps.folder' and trashed=false";
    const fallbackQuery = "mimeType='application/vnd.google-apps.folder' and trashed=false";

    async function listAllFolders(query) {
      const allFiles = [];
      let pageToken = undefined;

      do {
        const response = await drive.files.list({
          q: query,
          fields: "nextPageToken, files(id,name,mimeType,trashed,parents,driveId)",
          pageSize: 1000,
          pageToken,
          supportsAllDrives: true,
          includeItemsFromAllDrives: true,
          corpora: "allDrives",
        });

        console.log("[GET /get-folders] Drive API raw response:", JSON.stringify(response.data, null, 2));

        const files = Array.isArray(response.data?.files) ? response.data.files : [];
        allFiles.push(...files);
        pageToken = response.data?.nextPageToken || undefined;
      } while (pageToken);

      return allFiles;
    }

    const allFiles = await listAllFolders(parentQuery);

    const mappedFolders = allFiles
      .map((file) => ({
        id: typeof file?.id === "string" ? file.id.trim() : "",
        name: typeof file?.name === "string" ? file.name.trim() : "",
      }))
      .filter((folder) => folder.id && folder.name);

    const folders = Array.from(
      mappedFolders.reduce((acc, folder) => {
        if (!acc.has(folder.id)) {
          acc.set(folder.id, folder);
        }
        return acc;
      }, new Map()).values()
    );

    if (folders.length === 0) {
      console.log("[GET /get-folders] No folders found with parent filter. Running fallback visibility query.");
      const fallbackFiles = await listAllFolders(fallbackQuery);
      const fallbackMapped = fallbackFiles
        .map((file) => ({
          id: typeof file?.id === "string" ? file.id.trim() : "",
          name: typeof file?.name === "string" ? file.name.trim() : "",
          parents: Array.isArray(file?.parents) ? file.parents : [],
          driveId: typeof file?.driveId === "string" ? file.driveId : "",
        }))
        .filter((folder) => folder.id && folder.name);

      console.log("[GET /get-folders] Fallback mapped folders:", fallbackMapped);
    }

    console.log("[GET /get-folders] Final mapped response:", folders);
    return res.json(folders);
  } catch (error) {
    console.error("[GET /get-folders] Failed to fetch folders");
    console.error("[GET /get-folders] Error message:", error.message);
    console.error("[GET /get-folders] Error status:", error.response?.status || "<none>");
    console.error("[GET /get-folders] Error details:", error.response?.data || error.stack || error);

    return res.status(500).json({
      success: false,
      error: "Failed to fetch folders",
      details: error.message,
    });
  }
}

module.exports = { getImages, getFolders };
