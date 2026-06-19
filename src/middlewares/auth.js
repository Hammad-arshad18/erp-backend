const jwt = require("jsonwebtoken");
const { ObjectId } = require("mongodb");
const { db } = require("../utils/db");
const { HttpError, getJwtSecret, JWT_ALGORITHM, docOut, hasPerm } = require("../utils/helpers");

// Mirrors get_current_user dependency: reads access_token cookie or Bearer header,
// verifies it, loads the user, and attaches req.user = doc_out(user).
async function authenticate(req, res, next) {
  try {
    let token = req.cookies ? req.cookies.access_token : null;
    if (!token) {
      const authHeader = req.headers["authorization"] || "";
      if (authHeader.startsWith("Bearer ")) {
        token = authHeader.slice(7);
      }
    }
    if (!token) {
      throw new HttpError(401, "Not authenticated");
    }
    let payload;
    try {
      payload = jwt.verify(token, getJwtSecret(), { algorithms: [JWT_ALGORITHM] });
    } catch (e) {
      if (e.name === "TokenExpiredError") {
        throw new HttpError(401, "Token expired");
      }
      throw new HttpError(401, "Invalid token");
    }
    if (payload.type !== "access") {
      throw new HttpError(401, "Invalid token type");
    }
    let user;
    try {
      user = await db.collection("users").findOne({ _id: new ObjectId(payload.sub) });
    } catch (e) {
      user = null;
    }
    if (!user) {
      throw new HttpError(401, "User not found");
    }
    req.user = docOut(user);
    next();
  } catch (e) {
    next(e);
  }
}

function requireAdmin(req, res, next) {
  const role = req.user && req.user.role;
  if (role !== "admin" && role !== "super_admin") {
    return next(new HttpError(403, "Admin only"));
  }
  next();
}

function requireSuperAdmin(req, res, next) {
  if (!req.user || req.user.role !== "super_admin") {
    return next(new HttpError(403, "Super admin only"));
  }
  next();
}

// Equivalent to require_perm(perm)
function requirePerm(perm) {
  return (req, res, next) => {
    if (!hasPerm(req.user, perm)) {
      return next(new HttpError(403, `Missing permission: ${perm}`));
    }
    next();
  };
}

module.exports = { authenticate, requireAdmin, requireSuperAdmin, requirePerm };
