import express from "express";

const adminRouter = express.Router();

// Endpoint credentials authorize MCP access, not global server administration.
// These operations are disabled until a separate administrator boundary exists.
adminRouter.all("/:endpoint_name/admin/{*path}", (_req, res) => {
  res
    .status(410)
    .json({
      error: "endpoint_admin_disabled",
      message:
        "Endpoint admin operations are disabled. Use the authenticated management interface.",
    });
});

export default adminRouter;
