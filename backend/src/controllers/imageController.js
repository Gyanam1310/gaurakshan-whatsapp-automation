const path = require("path");
const { google } = require("googleapis");
const { logger } = require("../config/logger");

const imageLogger = logger.child({ component: "image-controller" });

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
  imageLogger.info("get_folders_request_started");

  const keyFileFromEnv = process.env.GOOGLE_SERVICE_ACCOUNT_KEY;
  const parentFolderId = process.env.DRIVE_FOLDER_ID;

  imageLogger.info("get_folders_parent_folder", {
    parentFolderId: parentFolderId || "<missing>",
  });

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

        imageLogger.debug("get_folders_drive_raw_response", {
          response: response.data,
        });

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
      imageLogger.warn("get_folders_empty_parent_query_running_fallback");
      const fallbackFiles = await listAllFolders(fallbackQuery);
      const fallbackMapped = fallbackFiles
        .map((file) => ({
          id: typeof file?.id === "string" ? file.id.trim() : "",
          name: typeof file?.name === "string" ? file.name.trim() : "",
          parents: Array.isArray(file?.parents) ? file.parents : [],
          driveId: typeof file?.driveId === "string" ? file.driveId : "",
        }))
        .filter((folder) => folder.id && folder.name);

      imageLogger.info("get_folders_fallback_result", {
        count: fallbackMapped.length,
      });
    }

    imageLogger.info("get_folders_success", {
      count: folders.length,
    });
    return res.json(folders);
  } catch (error) {
    imageLogger.error("get_folders_failed", {
      message: error.message,
      status: error.response?.status || null,
      details: error.response?.data || error.stack || null,
    });

    return res.status(500).json({
      success: false,
      error: "Failed to fetch folders",
      details: error.message,
    });
  }
}

module.exports = { getImages, getFolders };
