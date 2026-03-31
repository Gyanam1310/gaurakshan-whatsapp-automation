const familySelect = document.getElementById("familySelect");
const familyNameInput = document.getElementById("familyName");
const imageGrid = document.getElementById("imageGrid");
const uploadImageInput = document.getElementById("uploadImageInput");
const selectedImagePreviewContainer = document.getElementById("selectedImagePreviewContainer");
const selectedImagePreview = document.getElementById("selectedImagePreview");

const messageForm = document.getElementById("messageForm");
const submitBtn = document.getElementById("submitBtn");
const statusBox = document.getElementById("status");

const postTypeInput = document.getElementById("postType");
const donationTypeInput = document.getElementById("donationType");
const donationDateInput = document.getElementById("donationDate");
const mainPersonNameGroup = document.getElementById("mainPersonNameGroup");
const mainPersonNameInput = document.getElementById("mainPersonName");
const occasionTextGroup = document.getElementById("occasionTextGroup");
const occasionTextInput = document.getElementById("occasionText");
const countGroup = document.getElementById("countGroup");
const countTextInput = document.getElementById("countText");
const locationInput = document.getElementById("location");
const customMessageInput = document.getElementById("customMessage");
const fullMessageGroup = document.getElementById("fullMessageGroup");
const fullMessageInput = document.getElementById("fullMessage");
const messagePreview = document.getElementById("messagePreview");

const donorsContainer = document.getElementById("donorsContainer");
const addDonorBtn = document.getElementById("addDonorBtn");

const messageBuilder = window.DonationMessageBuilder;

if (!messageBuilder || typeof messageBuilder.generateMessage !== "function") {
  throw new Error("DonationMessageBuilder is not available in the frontend context");
}

let selectedFolderId = "";
let selectedDriveImageUrl = "";
let uploadedImageUrl = "";
let selectedImageUrl = "";
let activeImageLoadRequestId = 0;
let latestFormattedMessage = "";

const driveFamiliesById = new Map();

const DRIVE_API_KEY = "AIzaSyCLFwdGAGueaB2G4t6oDoDK3Bwu_QL-8LY";
const DRIVE_PARENT_FOLDER_ID = "1CXzAcpfArGp5Yp-zXvqrVAx9ZfwIaqiur7e6eG1GRhUXj3qInovdLxYtz00s8uImh0Bs5d3p";
const DRIVE_FILES_API_BASE_URL = "https://www.googleapis.com/drive/v3/files";
const API_BASE = window.__API_BASE__ || "/api";
const FOLDERS_API_URL = `${API_BASE}/get-folders`;

const familyNameHindiMap = {
  "Sharma Family": "शर्मा परिवार",
  "Jain Family": "जैन परिवार",
  "Bhandari Family": "भंडारी परिवार",
  "Gupta Family": "गुप्ता परिवार",
};

function showStatus(message, type) {
  statusBox.textContent = message;
  statusBox.className = `status ${type}`;
}

function setDefaultDonationDate() {
  donationDateInput.value = new Date().toISOString().slice(0, 10);
}

function isMainPersonRequired(postType) {
  return postType === "Birthday" || postType === "Punyatithi" || postType === "Anniversary";
}

function shouldEnableCountField(postType) {
  return postType === "Birthday" || postType === "Anniversary" || postType === "Punyatithi";
}

function updateCountPlaceholder(postType) {
  const countField = document.getElementById("count") || countTextInput;
  if (!countField) {
    return;
  }

  switch (postType) {
    case "Birthday":
      countField.placeholder = "जैसे: 5वां जन्मदिन";
      break;
    case "Anniversary":
      countField.placeholder = "जैसे: 5वीं सालगिरह";
      break;
    case "Punyatithi":
      countField.placeholder = "जैसे: 5वीं पुण्यतिथि";
      break;
    default:
      countField.placeholder = "";
  }
}

function createDonorItem(donor = {}) {
  const item = document.createElement("div");
  item.className = "donor-item";
  item.innerHTML = `
    <label>
      Name
      <input type="text" class="input-lg donor-name" placeholder="Donor name" value="${donor.name || ""}" required>
    </label>
    <label>
      Relation
      <input type="text" class="input-lg donor-relation" placeholder="Optional" value="${donor.relation || ""}">
    </label>
    <button type="button" class="btn-secondary remove-donor-btn">Remove</button>
  `;
  return item;
}

function updateDonorPlaceholders() {
  const donorItems = donorsContainer.querySelectorAll(".donor-item");
  donorItems.forEach((item, index) => {
    const nameInput = item.querySelector(".donor-name");
    if (nameInput) {
      nameInput.placeholder = `Donor ${index + 1} name`;
    }
  });
}

function addDonor(donor = {}) {
  donorsContainer.appendChild(createDonorItem(donor));
  updateDonorPlaceholders();
  updatePreview();
  updateSubmitState();
}

function removeDonor(button) {
  const donorItems = donorsContainer.querySelectorAll(".donor-item");
  if (donorItems.length <= 1) {
    alert("At least one donor is required");
    return;
  }

  const donorItem = button.closest(".donor-item");
  if (!donorItem) {
    return;
  }

  donorItem.classList.add("removing");
  setTimeout(() => {
    donorItem.remove();
    updateDonorPlaceholders();
    updatePreview();
    updateSubmitState();
  }, 200);
}

function getDonors() {
  const donorItems = donorsContainer.querySelectorAll(".donor-item");
  return Array.from(donorItems)
    .map((item) => ({
      name: item.querySelector(".donor-name")?.value.trim() || "",
      relation: item.querySelector(".donor-relation")?.value.trim() || "",
    }))
    .filter((donor) => donor.name);
}

function togglePostTypeFields() {
  const postType = postTypeInput.value;
  const isOtherOccasion = postType === "Other Occasion";
  const isCustomTemplate = postType === "Custom Template";
  const needsMainPerson = isMainPersonRequired(postType);
  const canUseCount = shouldEnableCountField(postType);

  occasionTextGroup.style.display = isOtherOccasion ? "block" : "none";
  fullMessageGroup.style.display = isCustomTemplate ? "block" : "none";
  mainPersonNameGroup.style.display = needsMainPerson ? "block" : "none";
  if (countGroup) {
    countGroup.style.display = canUseCount ? "block" : "none";
  }

  countTextInput.disabled = !canUseCount;
  if (!canUseCount) {
    countTextInput.value = "";
  }
  updateCountPlaceholder(postType);

  if (!isOtherOccasion) {
    occasionTextInput.value = "";
  }

  if (!isCustomTemplate) {
    fullMessageInput.value = "";
  }

  if (!needsMainPerson) {
    mainPersonNameInput.value = "";
  }
}

function getFormData() {
  const postType = postTypeInput.value;

  return {
    donationDate: donationDateInput.value,
    postType,
    donationType: donationTypeInput.value.trim(),
    donors: getDonors(),
    mainPersonName: mainPersonNameInput.value.trim(),
    familyName: familyNameInput.value.trim(),
    occasion: postType === "Other Occasion" ? occasionTextInput.value.trim() : "",
    count: countTextInput.value.trim(),
    location: locationInput.value.trim(),
    customMessage: customMessageInput.value.trim(),
    imageUrl: selectedImageUrl,
    fullMessage: postType === "Custom Template" ? fullMessageInput.value.trim() : "",
  };
}

function attachFormattedMessage(formData) {
  const enriched = { ...formData };
  enriched.formattedMessage = messageBuilder.generateMessage(enriched);
  latestFormattedMessage = enriched.formattedMessage;
  return enriched;
}

function escapeHtml(text) {
  return String(text || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function renderPreview(text) {
  return escapeHtml(text)
    .replace(/\*(.*?)\*/g, "<b>$1</b>")
    .replace(/\n/g, "<br>");
}

function updatePreview() {
  const formData = attachFormattedMessage(getFormData());
  messagePreview.innerHTML = renderPreview(formData.formattedMessage || "Preview will appear here...");
}

function validateForm(showAlert = false) {
  const formData = getFormData();

  if (!formData.donationDate) {
    if (showAlert) {
      alert("Donation date is required");
    }
    return false;
  }

  if (!formData.postType) {
    if (showAlert) {
      alert("Post type is required");
    }
    return false;
  }

  if (formData.donors.length < 1) {
    if (showAlert) {
      alert("At least one donor is required");
    }
    return false;
  }

  if (!formData.familyName) {
    if (showAlert) {
      alert("Family name is required");
    }
    return false;
  }

  if (!formData.donationType) {
    if (showAlert) {
      alert("Donation type is required");
    }
    return false;
  }

  if (isMainPersonRequired(formData.postType) && !formData.mainPersonName) {
    if (showAlert) {
      alert("Main person name is required for the selected post type");
    }
    return false;
  }

  if (formData.postType === "Other Occasion" && !formData.occasion) {
    if (showAlert) {
      alert("Occasion is required for Other Occasion");
    }
    return false;
  }

  if (formData.postType === "Custom Template" && !formData.fullMessage) {
    if (showAlert) {
      alert("Full message is required in Custom Template mode");
    }
    return false;
  }

  if (!formData.imageUrl) {
    if (showAlert) {
      alert("Please select or upload an image");
    }
    return false;
  }

  return true;
}

function updateSubmitState() {
  submitBtn.disabled = !validateForm(false);
}

function toMultipartFormData(formData, file) {
  const multipartData = new FormData();
  multipartData.append("donationDate", formData.donationDate || "");
  multipartData.append("formattedMessage", formData.formattedMessage || "");
  multipartData.append("postType", formData.postType || "");
  multipartData.append("donationType", formData.donationType || "");
  multipartData.append("donors", JSON.stringify(formData.donors || []));
  multipartData.append("mainPersonName", formData.mainPersonName || "");
  multipartData.append("familyName", formData.familyName || "");
  multipartData.append("occasion", formData.occasion || "");
  multipartData.append("count", formData.count || "");
  multipartData.append("location", formData.location || "");
  multipartData.append("customMessage", formData.customMessage || "");
  multipartData.append("fullMessage", formData.fullMessage || "");
  multipartData.append("image", file);
  return multipartData;
}

function syncSelectedImagePreview() {
  if (!selectedImageUrl) {
    selectedImagePreviewContainer.style.display = "none";
    selectedImagePreviewContainer.style.opacity = "0";
    selectedImagePreview.removeAttribute("src");
    return;
  }

  selectedImagePreview.src = selectedImageUrl;
  selectedImagePreview.alt = "Selected image";
  selectedImagePreviewContainer.style.display = "block";
  requestAnimationFrame(() => {
    selectedImagePreviewContainer.style.opacity = "1";
  });
}

function applyImageSelection() {
  selectedImageUrl = uploadedImageUrl || selectedDriveImageUrl || "";
  syncSelectedImagePreview();
  updatePreview();
  updateSubmitState();
}

function logFamilySelectDiagnostics() {
  if (!familySelect) {
    console.error("[familySelect] Element not found in DOM");
    return;
  }

  const computed = window.getComputedStyle(familySelect);
  const rect = familySelect.getBoundingClientRect();
  const centerX = Math.floor(rect.left + rect.width / 2);
  const centerY = Math.floor(rect.top + rect.height / 2);
  const topElement = document.elementFromPoint(centerX, centerY);

  console.log("[familySelect] diagnostics", {
    id: familySelect.id,
    optionCount: familySelect.options.length,
    color: computed.color,
    backgroundColor: computed.backgroundColor,
    opacity: computed.opacity,
    visibility: computed.visibility,
    fontSize: computed.fontSize,
    rect: {
      x: Math.round(rect.x),
      y: Math.round(rect.y),
      width: Math.round(rect.width),
      height: Math.round(rect.height),
    },
    topElementTag: topElement?.tagName || null,
    topElementId: topElement?.id || null,
  });
}

async function loadFamilies() {
  familySelect.disabled = true;
  familySelect.innerHTML = '<option value="">Loading families...</option>';

  try {
    const response = await fetch(FOLDERS_API_URL);

    if (!response.ok) {
      throw new Error(`Folders API request failed with status ${response.status}`);
    }

    const data = await response.json();
    console.log("API response:", data);

    if (!Array.isArray(data)) {
      throw new Error("Invalid folders response format");
    }

    const folders = data
      .map((folder) => ({
        id: typeof folder?.id === "string" ? folder.id.trim() : "",
        name: typeof folder?.name === "string" ? folder.name.trim() : "",
      }))
      .filter((folder) => folder.id && folder.name);

    driveFamiliesById.clear();
    familySelect.innerHTML = '<option value="">Select family...</option>';

    folders
      .sort((a, b) => a.name.localeCompare(b.name))
      .forEach((folder) => {
        driveFamiliesById.set(folder.id, folder.name);
        const option = document.createElement("option");
        option.value = folder.id;
        option.textContent = folder.name;
        familySelect.appendChild(option);
        console.log("[familySelect] appended option", {
          value: option.value,
          text: option.textContent,
        });
      });

    console.log("[familySelect] total options after render", familySelect.options.length);
    logFamilySelectDiagnostics();

    if (driveFamiliesById.size === 0) {
      const option = document.createElement("option");
      option.value = "";
      option.textContent = "No families found";
      option.disabled = true;
      familySelect.appendChild(option);
    }
  } catch (error) {
    familySelect.innerHTML = '<option value="">Select family...</option>';

    const option = document.createElement("option");
    option.value = "";
    option.textContent = "Unable to load families";
    option.disabled = true;
    familySelect.appendChild(option);

    showStatus("Unable to load families", "error");
    console.error("Failed to load families:", error);
    logFamilySelectDiagnostics();
  } finally {
    familySelect.disabled = false;
  }
}

function getDriveImagesApiUrl(folderId) {
  const params = new URLSearchParams({
    q: `'${folderId}' in parents and mimeType contains 'image' and trashed = false`,
    fields: "files(id,name,mimeType)",
    pageSize: "200",
    key: DRIVE_API_KEY,
  });

  return `${DRIVE_FILES_API_BASE_URL}?${params.toString()}`;
}

function getDriveImageUrls(fileId) {
  return {
    thumbnailUrl: `https://drive.google.com/thumbnail?id=${fileId}&sz=w1000`,
    directUrl: `https://drive.google.com/uc?id=${fileId}`,
  };
}

function logImageGridDiagnostics() {
  if (!imageGrid) {
    console.error("[imageGrid] Element not found in DOM");
    return;
  }

  const gridComputed = window.getComputedStyle(imageGrid);
  const gridRect = imageGrid.getBoundingClientRect();
  const centerX = Math.floor(gridRect.left + gridRect.width / 2);
  const centerY = Math.floor(gridRect.top + gridRect.height / 2);
  const topElement = document.elementFromPoint(centerX, centerY);

  const firstImg = imageGrid.querySelector("img");
  const firstImgComputed = firstImg ? window.getComputedStyle(firstImg) : null;

  console.log("[imageGrid] diagnostics", {
    itemCount: imageGrid.querySelectorAll(".image-item").length,
    imgCount: imageGrid.querySelectorAll("img").length,
    grid: {
      display: gridComputed.display,
      opacity: gridComputed.opacity,
      visibility: gridComputed.visibility,
      width: gridComputed.width,
      height: gridComputed.height,
      rect: {
        x: Math.round(gridRect.x),
        y: Math.round(gridRect.y),
        width: Math.round(gridRect.width),
        height: Math.round(gridRect.height),
      },
    },
    firstImg: firstImg
      ? {
        src: firstImg.getAttribute("src"),
        currentSrc: firstImg.currentSrc || firstImg.getAttribute("src"),
        display: firstImgComputed?.display,
        opacity: firstImgComputed?.opacity,
        visibility: firstImgComputed?.visibility,
        width: firstImgComputed?.width,
        height: firstImgComputed?.height,
      }
      : null,
    topElementTag: topElement?.tagName || null,
    topElementId: topElement?.id || null,
    topElementClass: topElement?.className || null,
  });
}

async function loadImages(folderId) {
  const requestId = ++activeImageLoadRequestId;
  console.log("[images] loadImages called", { folderId, requestId });

  selectedDriveImageUrl = "";
  imageGrid.innerHTML = "";

  if (!folderId) {
    console.log("[images] No folder selected, clearing image grid");
    applyImageSelection();
    return;
  }

  console.log("[images] Before loading, grid children:", imageGrid.children.length);
  imageGrid.innerHTML = "<p>Loading images...</p>";

  try {
    const driveApiUrl = getDriveImagesApiUrl(folderId);
    console.log("[images] Drive API URL:", driveApiUrl);

    const response = await fetch(driveApiUrl);
    if (!response.ok) {
      throw new Error(`Drive image request failed with status ${response.status}`);
    }

    const data = await response.json();
    console.log("Drive response:", data);

    const files = Array.isArray(data?.files) ? data.files : [];
    if (files.length === 0) {
      console.warn("[images] data.files is empty for folder", folderId);
    }

    const images = files
      .filter((file) => file?.id)
      .map((file) => {
        const urls = getDriveImageUrls(file.id);
        return {
          id: file.id,
          name: file.name || "Unnamed image",
          url: urls.thumbnailUrl,
          fallbackUrl: urls.directUrl,
        };
      });

    console.log("[images] mapped images:", images);

    if (requestId !== activeImageLoadRequestId) {
      console.log("[images] Stale request ignored", { requestId, activeImageLoadRequestId });
      return;
    }

    console.log("[images] Calling renderImages with count:", images.length);
    renderImages(images);
    console.log("[images] renderImages completed, grid children:", imageGrid.children.length);
    requestAnimationFrame(() => {
      logImageGridDiagnostics();
    });
  } catch (error) {
    if (requestId !== activeImageLoadRequestId) {
      return;
    }

    imageGrid.innerHTML = "<p>Failed to load images. Please try again.</p>";
    console.error("Failed to load images from Google Drive:", error);
    logImageGridDiagnostics();
  }
}

function renderImages(images) {
  console.log("[renderImages] start", {
    incomingCount: images.length,
    existingItems: imageGrid.querySelectorAll(".image-item").length,
  });

  imageGrid.innerHTML = "";

  if (images.length === 0) {
    imageGrid.innerHTML = "<p>No images found for this folder</p>";
    console.log("[renderImages] No images found for selected folder");
    applyImageSelection();
    return;
  }

  const fragment = document.createDocumentFragment();

  images.forEach((image) => {
    const item = document.createElement("button");
    item.type = "button";
    item.className = "image-item";

    const img = document.createElement("img");
    img.src = image.url;
    img.alt = image.name;
    img.dataset.loadedUrl = image.url;
    img.dataset.fallbackUrl = image.fallbackUrl;
    img.dataset.fallbackTried = "false";

    img.addEventListener("load", () => {
      img.dataset.loadedUrl = img.currentSrc || img.src;
      console.log("[renderImages] image loaded", {
        id: image.id,
        name: image.name,
        src: img.dataset.loadedUrl,
      });
    });

    img.addEventListener("error", () => {
      if (img.dataset.fallbackTried !== "true") {
        img.dataset.fallbackTried = "true";
        img.src = image.fallbackUrl;
        img.dataset.loadedUrl = image.fallbackUrl;
        console.warn("[renderImages] thumbnail failed; switched to direct URL", {
          id: image.id,
          name: image.name,
          fallbackUrl: image.fallbackUrl,
        });
        return;
      }

      console.error("[renderImages] image failed on both thumbnail and direct URL", {
        id: image.id,
        name: image.name,
        thumbnailUrl: image.url,
        directUrl: image.fallbackUrl,
        hint: "Check Google Drive sharing: Anyone with the link -> Viewer",
      });
    });

    const caption = document.createElement("div");
    caption.className = "image-name";
    caption.textContent = image.name;

    item.appendChild(img);
    item.appendChild(caption);

    item.addEventListener("click", () => {
      document.querySelectorAll(".image-item").forEach((el) => {
        el.classList.remove("selected");
      });

      item.classList.add("selected");
      selectedDriveImageUrl = img.dataset.loadedUrl || image.url;
      console.log("[renderImages] image selected", {
        id: image.id,
        name: image.name,
        selectedDriveImageUrl,
      });
      applyImageSelection();
    });

    fragment.appendChild(item);
  });

  console.log("[renderImages] appending fragment to imageGrid");
  imageGrid.appendChild(fragment);
  console.log("[renderImages] after append", {
    itemCount: imageGrid.querySelectorAll(".image-item").length,
    imgCount: imageGrid.querySelectorAll("img").length,
  });
  applyImageSelection();
}

function handleUploadImageChange(event) {
  const file = event.target.files?.[0];

  if (!file) {
    uploadedImageUrl = "";
    applyImageSelection();
    return;
  }

  const reader = new FileReader();
  reader.onload = () => {
    uploadedImageUrl = typeof reader.result === "string" ? reader.result : "";
    document.querySelectorAll(".image-item").forEach((item) => {
      item.classList.remove("selected");
    });
    applyImageSelection();
  };
  reader.readAsDataURL(file);
}

familySelect.addEventListener("change", (event) => {
  selectedFolderId = event.target.value;
  const selectedFamilyName = driveFamiliesById.get(selectedFolderId) || "";

  console.log("[familySelect] change event", {
    selectedFolderId,
    selectedFamilyName,
  });

  familyNameInput.value = familyNameHindiMap[selectedFamilyName] || selectedFamilyName;
  loadImages(selectedFolderId);
  updatePreview();
  updateSubmitState();
});

addDonorBtn.addEventListener("click", () => {
  addDonor();
});

donorsContainer.addEventListener("click", (event) => {
  const removeButton = event.target.closest(".remove-donor-btn");
  if (removeButton) {
    removeDonor(removeButton);
  }
});

uploadImageInput.addEventListener("change", handleUploadImageChange);

postTypeInput.addEventListener("change", () => {
  togglePostTypeFields();
  updatePreview();
  updateSubmitState();
});

messageForm.addEventListener("input", () => {
  updatePreview();
  updateSubmitState();
});

messageForm.addEventListener("submit", async (event) => {
  event.preventDefault();

  if (!validateForm(true)) {
    updateSubmitState();
    return;
  }

  updatePreview();

  const formData = getFormData();
  formData.formattedMessage = latestFormattedMessage;
  const uploadedFile = uploadImageInput.files?.[0] || null;

  if (!formData.formattedMessage || !formData.formattedMessage.trim()) {
    showStatus("Formatted message is required", "error");
    return;
  }

  const payload = {
    ...formData,
  };

  showStatus("Saving donation...", "");

  try {
    console.log("Calling API:", `${API_BASE}/save-donation`);

    const response = uploadedFile
      ? await fetch(`${API_BASE}/save-donation`, {
        method: "POST",
        body: toMultipartFormData(formData, uploadedFile),
      })
      : await fetch(`${API_BASE}/save-donation`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
      });

    const responseText = await response.text();
    console.log("save-donation raw response:", responseText);

    let result = {};
    if (responseText) {
      try {
        result = JSON.parse(responseText);
      } catch {
        if (response.ok) {
          throw new Error("Invalid JSON response from backend");
        }
      }
    }

    if (!response.ok) {
      console.error("save-donation failed response text:", responseText);
      throw new Error(result?.error || responseText || "Failed to save donation");
    }

    showStatus("Data saved successfully", "success");

    messageForm.reset();
    donorsContainer.innerHTML = "";
    addDonor();
    setDefaultDonationDate();
    togglePostTypeFields();

    selectedDriveImageUrl = "";
    uploadedImageUrl = "";
    selectedImageUrl = "";
    uploadImageInput.value = "";
    document.querySelectorAll(".image-item").forEach((item) => {
      item.classList.remove("selected");
    });

    syncSelectedImagePreview();
    updatePreview();
    updateSubmitState();
  } catch (error) {
    showStatus(error.message || "Failed to save donation", "error");
  }
});

function initialize() {
  addDonor();
  setDefaultDonationDate();
  togglePostTypeFields();
  updatePreview();
  updateSubmitState();
  loadFamilies();
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", initialize, { once: true });
} else {
  initialize();
}
