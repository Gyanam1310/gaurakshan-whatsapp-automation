(function (root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory();
  } else {
    root.DonationMessageBuilder = factory();
  }
}(typeof self !== "undefined" ? self : this, function () {
  function clean(value) {
    return typeof value === "string" ? value.trim() : "";
  }

  function normalizeDonors(donors) {
    if (!Array.isArray(donors)) {
      return [];
    }

    return donors
      .map(function (donor) {
        return {
          name: clean(donor && donor.name),
          relation: clean(donor && donor.relation),
        };
      })
      .filter(function (donor) {
        return donor.name;
      });
  }

  function translateRelation(relation) {
    var value = clean(relation);
    if (!value) {
      return "";
    }

    var relationMap = {
      father: "पिता",
      mother: "माता",
      son: "पुत्र",
      daughter: "पुत्री",
      husband: "पति",
      wife: "पत्नी",
    };

    var translated = relationMap[value.toLowerCase()];
    if (translated) {
      return translated;
    }

    // Skip unknown raw-English relation tokens to keep message Hindi-first.
    if (/^[a-z\s]+$/i.test(value)) {
      return "";
    }

    return value;
  }

  function formatDonor(donor, includeRelation) {
    var name = clean(donor && donor.name);
    if (!name) {
      return "";
    }

    var label = "*" + name + "*";
    if (!includeRelation) {
      return label;
    }

    var translatedRelation = translateRelation(donor && donor.relation);
    if (!translatedRelation) {
      return label;
    }

    return label + " (" + translatedRelation + ")";
  }

  function formatDonors(donors, includeRelation) {
    var list = normalizeDonors(donors)
      .map(function (donor) {
        return formatDonor(donor, includeRelation);
      })
      .filter(function (label) {
        return label;
      });

    if (list.length === 0) {
      return "";
    }

    if (list.length === 1) {
      return list[0];
    }

    if (list.length === 2) {
      return list[0] + " एवं " + list[1];
    }

    return list.slice(0, -1).join(", ") + " एवं " + list[list.length - 1];
  }

  function getPunyatithiText(count) {
    var numeric = parseInt(clean(count), 10);
    if (!Number.isFinite(numeric)) {
      return "";
    }

    return numeric + "वीं पुण्यतिथि";
  }

  function normalizePostType(postType) {
    var value = clean(postType);
    if (value === "Punyatithi") {
      return "Punyathithi";
    }
    return value;
  }

  function getOccasionLine(postType) {
    switch (normalizePostType(postType)) {
      case "Birthday":
        return "के जन्मदिन के शुभ अवसर पर 🎂";
      case "Anniversary":
        return "की सालगिरह के शुभ अवसर पर 💐";
      case "Punyathithi":
        return "की पुण्यतिथि पर 🙏";
      default:
        return "";
    }
  }

  function getDonationLine(donationType) {
    var value = clean(donationType);
    if (!value) {
      return "";
    }

    if (value.indexOf("एक समय") !== -1) {
      return "एक समय का गौ-आहार प्रदान कर्ता है :-";
    }

    if (value.indexOf("पूरे दिन") !== -1) {
      return "पूरे दिन का गौ-आहार प्रदान कर्ता है :-";
    }

    return value + " प्रदान कर्ता है :-";
  }

  function centerText(text, width) {
    var value = typeof text === "string" ? text : "";
    if (!value) {
      return "";
    }

    var targetWidth = Number.isFinite(width) ? width : 40;
    var len = value.length;
    if (len >= targetWidth) {
      return value;
    }

    var spaces = Math.floor((targetWidth - len) / 2);
    return " ".repeat(spaces) + value;
  }

  function buildDonorLine(donorName) {
    var name = clean(donorName);
    if (!name) {
      return "";
    }

    return name + " द्वारा प्रदान किया जा रहा है";
  }

  function generateMessage(data) {
    var fullMessage = clean(data && data.fullMessage);
    if (fullMessage) {
      return fullMessage;
    }

    var postType = normalizePostType(data && data.postType);
    var donationType = clean(data && data.donationType);
    var donationLine = getDonationLine(donationType);

    var mainPersonName = clean(data && data.mainPersonName);
    var occasionText = clean(data && data.occasion);
    var location = clean(data && data.location);
    var customMessage = clean(data && data.customMessage);
    var occasionLine = postType === "Other Occasion"
      ? (occasionText ? "के " + occasionText + " के शुभ अवसर पर" : "")
      : getOccasionLine(postType);

    var donorName = clean(data && data.donorName);
    var familyName = clean(data && data.familyName);

    var donors = normalizeDonors(data && data.donors);
    if (!donorName && donors.length > 0) {
      donorName = donors[0].name;
    }
    var donorLine = buildDonorLine(donorName);
    var familyThankYouLine = familyName ? familyName + " परिवार का बहुत बहुत धन्यवाद" : "";
    var alignWidth = parseInt(data && data.alignWidth, 10);
    if (!Number.isFinite(alignWidth) || alignWidth < 40) {
      alignWidth = 40;
    }

    var lines = [];

    function pushCentered(line) {
      var value = clean(line);
      if (!value) {
        return;
      }
      lines.push(centerText(value, alignWidth));
    }

    function pushGap() {
      if (lines.length === 0 || lines[lines.length - 1] === "") {
        return;
      }
      lines.push("");
    }

    pushCentered("जय जिनेंद्र 🙏  राम राम 🙏  जय गौ माता");
    pushCentered("🔶 उज्जवल गौशाला ट्रस्ट 🔶");
    pushCentered("मुजबी, भंडारा");

    if (donationLine) {
      pushGap();
      pushCentered(donationLine);
    }

    if (mainPersonName) {
      pushGap();
      pushCentered("🔸 " + mainPersonName);
      if (occasionLine) {
        pushCentered(occasionLine);
      }
    }

    if (location) {
      pushGap();
      pushCentered(location);
    }

    if (donorLine) {
      pushGap();
      pushCentered("🔸 " + donorLine);
    }

    if (customMessage) {
      pushGap();
      pushCentered(customMessage);
    }

    if (familyThankYouLine) {
      pushGap();
      pushCentered(familyThankYouLine);
    }

    pushGap();
    pushCentered("🌼 गौ सेवा ही प्रभु सेवा");
    pushCentered("🌼 जीव-सेवा ही श्रेष्ठ दान");

    return lines.join("\n").replace(/[ \t]+$/gm, "").trim();
  }

  return {
    generateMessage: generateMessage,
    normalizeDonors: normalizeDonors,
    formatDonors: formatDonors,
    getPunyatithiText: getPunyatithiText,
    getOccasionLine: getOccasionLine,
    getDonationLine: getDonationLine,
    buildDonorLine: buildDonorLine,
    centerText: centerText,
  };
}));
