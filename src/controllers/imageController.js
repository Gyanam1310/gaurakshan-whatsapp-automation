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

module.exports = { getImages };
