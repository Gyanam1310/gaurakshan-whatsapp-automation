const familySelect = document.getElementById("familySelect");
const imageGrid = document.getElementById("imageGrid");
const messageForm = document.getElementById("messageForm");
const statusBox = document.getElementById("status");

const donorNameInput = document.getElementById("donorName");
const donor1Input = document.getElementById("donor1");
const donor2Input = document.getElementById("donor2");
const donor3Input = document.getElementById("donor3");
const husbandNameInput = document.getElementById("husbandName");
const wifeNameInput = document.getElementById("wifeName");

const donorSingleGroup = document.getElementById("donorSingleGroup");
const donorMultipleGroup = document.getElementById("donorMultipleGroup");
const donorModeGroup = document.getElementById("donorModeGroup");
const donorModeInput = document.getElementById("donorMode");
const anniversaryGroup = document.getElementById("anniversaryGroup");

const familyNameInput = document.getElementById("familyName");
const locationInput = document.getElementById("location");
const customMessageInput = document.getElementById("customMessage");
const postTypeInput = document.getElementById("postType");
const donationTypeInput = document.getElementById("donationType");
const occasionTypeTextInput = document.getElementById("occasionTypeText");
const inTheNameInput = document.getElementById("inTheName");
const countTextInput = document.getElementById("countText");

const occasionTypeGroup = document.getElementById("occasionTypeGroup");
const inTheNameGroup = document.getElementById("inTheNameGroup");
const countGroup = document.getElementById("countGroup");

let groupedImages = [];
let selectedImageUrl = "";

const familyNameHindiMap = {
  "Sharma Family": "शर्मा परिवार",
  "Jain Family": "जैन परिवार",
  "Bhandari Family": "भंडारी परिवार",
  "Gupta Family": "गुप्ता परिवार",
};

function showField(element, show) {
  element.style.display = show ? "block" : "none";
}

function clearValue(input) {
  input.value = "";
}

async function loadFamilies() {
  try {
    const response = await fetch("/images");
    const data = await response.json();

    groupedImages = Array.isArray(data) ? data : [];

    familySelect.innerHTML = '<option value="">Select family...</option>';
    groupedImages.forEach((group) => {
      const option = document.createElement("option");
      option.value = group.family;
      option.textContent = group.family;
      familySelect.appendChild(option);
    });
  } catch (error) {
    showStatus("Failed to load family list", "error");
  }
}

async function renderImagesByFamily(familyName) {
  imageGrid.innerHTML = "";
  selectedImageUrl = "";

  if (!familyName) {
    return;
  }

  const selectedGroup = groupedImages.find((item) => item.family === familyName);
  const images = selectedGroup?.images || [];

  if (images.length === 0) {
    imageGrid.innerHTML = "<p>No images found for this family.</p>";
    return;
  }

  images.forEach((image) => {
    const item = document.createElement("button");
    item.type = "button";
    item.className = "image-item";
    item.innerHTML = `
      <img src="${image.url}" alt="${image.name}">
      <div class="image-name">${image.name}</div>
    `;

    item.addEventListener("click", () => {
      document.querySelectorAll(".image-item").forEach((el) => {
        el.classList.remove("selected");
      });

      item.classList.add("selected");
      selectedImageUrl = image.url;
    });

    imageGrid.appendChild(item);
  });
}

function isMultiDonorEnabledByType(type) {
  if (type === "Multiple Donors") {
    return true;
  }

  if (type === "Festival / Occasion") {
    return true;
  }

  if ((type === "Punyatithi" || type === "Birthday") && donorModeInput.value === "multiple") {
    return true;
  }

  return false;
}

function updateFormByPostType(type) {
  const isGeneral = type === "General Donation";
  const isPunyatithi = type === "Punyatithi";
  const isBirthday = type === "Birthday";
  const isAnniversary = type === "Anniversary";
  const isFestival = type === "Festival / Occasion";
  const isMultipleDonors = type === "Multiple Donors";

  if (!(isPunyatithi || isBirthday)) {
    donorModeInput.value = "single";
  }

  const useMultipleDonors = isMultiDonorEnabledByType(type);

  showField(donorModeGroup, isPunyatithi || isBirthday);
  showField(anniversaryGroup, isAnniversary);
  showField(donorSingleGroup, !isAnniversary && !useMultipleDonors);
  showField(donorMultipleGroup, !isAnniversary && useMultipleDonors);

  showField(occasionTypeGroup, isFestival);
  showField(inTheNameGroup, isPunyatithi || isBirthday);
  showField(countGroup, isPunyatithi || isBirthday || isAnniversary);

  donorNameInput.required = !isAnniversary && !useMultipleDonors;
  donor1Input.required = !isAnniversary && useMultipleDonors;
  husbandNameInput.required = isAnniversary;
  wifeNameInput.required = isAnniversary;
  inTheNameInput.required = isPunyatithi || isBirthday;

  if (isPunyatithi) {
    countTextInput.placeholder = "e.g., 5वीं पुण्यतिथि";
  } else if (isBirthday) {
    countTextInput.placeholder = "e.g., 25वां जन्मदिन";
  } else if (isAnniversary) {
    countTextInput.placeholder = "e.g., 25वीं सालगिरह";
  } else {
    countTextInput.placeholder = "Count (optional)";
  }

  if (!isFestival) {
    clearValue(occasionTypeTextInput);
  }

  if (!(isPunyatithi || isBirthday)) {
    clearValue(inTheNameInput);
  }

  if (!(isPunyatithi || isBirthday || isAnniversary)) {
    clearValue(countTextInput);
  }

  if (isAnniversary) {
    clearValue(donorNameInput);
    clearValue(donor1Input);
    clearValue(donor2Input);
    clearValue(donor3Input);
  } else {
    clearValue(husbandNameInput);
    clearValue(wifeNameInput);
  }

  if (!useMultipleDonors) {
    clearValue(donor1Input);
    clearValue(donor2Input);
    clearValue(donor3Input);
  }

  if (useMultipleDonors) {
    clearValue(donorNameInput);
  }

  if (isGeneral) {
    clearValue(occasionTypeTextInput);
    clearValue(inTheNameInput);
    clearValue(countTextInput);
  }

  if (isMultipleDonors) {
    clearValue(occasionTypeTextInput);
    clearValue(inTheNameInput);
    clearValue(countTextInput);
  }
}

function getDonorText() {
  const type = postTypeInput.value;

  if (type === "Anniversary") {
    const husband = husbandNameInput.value.trim();
    const wife = wifeNameInput.value.trim();
    return `श्री ${husband} एवं श्रीमती ${wife}`;
  }

  if (isMultiDonorEnabledByType(type)) {
    return [
      donor1Input.value.trim(),
      donor2Input.value.trim(),
      donor3Input.value.trim(),
    ].filter(Boolean).join("\n");
  }

  return donorNameInput.value.trim();
}

function getOccasionText() {
  const type = postTypeInput.value;
  const donorText = getDonorText();
  const inTheName = inTheNameInput.value.trim();
  const countText = countTextInput.value.trim();
  const festivalType = occasionTypeTextInput.value.trim();

  if (type === "Punyatithi") {
    if (inTheName && countText) {
      return `${inTheName} की ${countText} के उपलक्ष्य में`;
    }
    if (inTheName) {
      return `${inTheName} की पुण्यतिथि के उपलक्ष्य में`;
    }
    if (countText) {
      return `${countText} के उपलक्ष्य में`;
    }
  }

  if (type === "Birthday") {
    if (inTheName && countText) {
      return `${inTheName} के ${countText} के उपलक्ष्य में`;
    }
    if (inTheName) {
      return `${inTheName} के जन्मदिन के उपलक्ष्य में`;
    }
    if (countText) {
      return `${countText} के उपलक्ष्य में`;
    }
  }

  if (type === "Anniversary") {
    if (countText) {
      return `${donorText} की ${countText} के अवसर पर`;
    }
    return `${donorText} की सालगिरह के अवसर पर`;
  }

  if (type === "Festival / Occasion" && festivalType) {
    return `❗${festivalType}❗ के अवसर पर`;
  }

  return "";
}

function buildMessage() {
  const donorText = getDonorText();
  const familyName = familyNameInput.value.trim();
  const location = locationInput.value.trim();
  const donationType = donationTypeInput.value.trim();
  const customMessage = customMessageInput.value.trim();
  const occasionText = getOccasionText();

  const lines = [
    `🙏 दाता: ${donorText}`,
    `🏠 परिवार: ${familyName}`,
  ];

  if (location) {
    lines.push(`📍 स्थान: ${location}`);
  }

  lines.push(`🎁 दान: ${donationType}`);

  if (occasionText) {
    lines.push("");
    lines.push(`🎗 ${occasionText}`);
  }

  if (customMessage) {
    lines.push("");
    lines.push(`💬 ${customMessage}`);
  }

  return lines.join("\n");
}

function showStatus(message, type) {
  statusBox.textContent = message;
  statusBox.className = `status ${type}`;
}

function validateRequiredFields() {
  const type = postTypeInput.value;
  const familyName = familyNameInput.value.trim();
  const donationType = donationTypeInput.value.trim();

  if (!familyName || !donationType) {
    alert("Please fill all required fields");
    return false;
  }

  if (type === "Anniversary") {
    if (!husbandNameInput.value.trim() || !wifeNameInput.value.trim()) {
      alert("Please fill Husband Name and Wife Name");
      return false;
    }
  } else if (isMultiDonorEnabledByType(type)) {
    if (!donor1Input.value.trim()) {
      alert("Please fill Donor 1");
      return false;
    }
  } else if (!donorNameInput.value.trim()) {
    alert("Please fill Donor Name");
    return false;
  }

  if ((type === "Punyatithi" || type === "Birthday") && !inTheNameInput.value.trim()) {
    alert("Please fill In the name of");
    return false;
  }

  return true;
}

familySelect.addEventListener("change", (event) => {
  const selected = event.target.value;
  familyNameInput.value = familyNameHindiMap[selected] || selected;
  renderImagesByFamily(selected);
});

postTypeInput.addEventListener("change", () => {
  updateFormByPostType(postTypeInput.value);
});

donorModeInput.addEventListener("change", () => {
  updateFormByPostType(postTypeInput.value);
});

messageForm.addEventListener("submit", async (event) => {
  event.preventDefault();

  if (!validateRequiredFields()) {
    return;
  }

  if (!selectedImageUrl) {
    alert("Please select an image");
    return;
  }

  showStatus("Sending message...", "");

  try {
    const response = await fetch("/send-message", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        message: buildMessage(),
        images: [selectedImageUrl],
      }),
    });

    const result = await response.json();

    if (!response.ok) {
      throw new Error(result?.error || "Failed to send message");
    }

    showStatus("Message sent successfully", "success");
    messageForm.reset();
    donorModeInput.value = "single";
    updateFormByPostType(postTypeInput.value);
    selectedImageUrl = "";
    document.querySelectorAll(".image-item").forEach((el) => {
      el.classList.remove("selected");
    });
  } catch (error) {
    showStatus(error.message || "Failed to send message", "error");
  }
});

updateFormByPostType(postTypeInput.value);
loadFamilies();
