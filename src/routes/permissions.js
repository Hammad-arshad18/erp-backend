const { asyncHandler } = require("../utils/helpers");
const { ALL_PERMISSIONS } = require("../utils/constants");
const { authenticate } = require("../middlewares/auth");

module.exports = (api) => {
  api.get("/permissions", authenticate, asyncHandler(async (req, res) => {
    res.json({ all: ALL_PERMISSIONS });
  }));
};
