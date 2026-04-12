const express = require("express");
const { getImages, getFolders } = require("../controllers/imageController");

const router = express.Router();

router.get("/images", getImages);
router.get("/get-folders", getFolders);
router.get("/families", getFolders);

module.exports = router;
