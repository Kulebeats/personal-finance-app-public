/**
 * File Upload Validation Middleware
 *
 * Security controls for file uploads:
 * - Magic byte validation using file-type package
 * - MIME type allowlist enforcement
 * - Blocked extension detection
 * - Double extension attack prevention
 *
 * SEC-03: File upload content validation
 */

import { Response, NextFunction } from "express";
import { fileTypeFromBuffer } from "file-type";
import { logger } from "../utils/logger";

// Allowed MIME types for imports
const ALLOWED_MIMES = new Set([
  "text/csv",
  "text/plain", // CSV files often detected as text/plain
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
]);

// Allowed file extensions
const ALLOWED_EXTENSIONS = new Set([".csv", ".xls", ".xlsx", ".txt"]);

// Blocked dangerous extensions
const BLOCKED_EXTENSIONS = new Set([
  ".exe",
  ".dll",
  ".sh",
  ".bash",
  ".bat",
  ".cmd",
  ".ps1",
  ".php",
  ".js",
  ".mjs",
  ".ts",
  ".html",
  ".htm",
  ".svg",
  ".xml",
  ".jar",
  ".py",
  ".rb",
  ".pl",
  ".scr",
  ".com",
  ".vbs",
  ".vbe",
  ".wsf",
  ".wsh",
  ".msi",
  ".app",
  ".dmg",
  ".iso",
]);

export interface FileValidationResult {
  valid: boolean;
  error?: string;
  detectedType?: string;
}

/**
 * Validate uploaded file content
 * @param buffer File buffer
 * @param filename Original filename
 * @returns Validation result
 */
export async function validateFileUpload(
  buffer: Buffer,
  filename: string
): Promise<FileValidationResult> {
  const lowerFilename = filename.toLowerCase();

  // 1. Check for blocked extensions
  for (const ext of BLOCKED_EXTENSIONS) {
    if (lowerFilename.endsWith(ext)) {
      logger.warn("Blocked file extension detected", {
        filename,
        extension: ext,
      });
      return {
        valid: false,
        error: `File type not allowed: ${ext}`,
      };
    }
  }

  // 2. Check for double extensions (e.g., file.csv.exe)
  const parts = lowerFilename.split(".");
  if (parts.length > 2) {
    for (let i = 1; i < parts.length - 1; i++) {
      const hiddenExt = `.${parts[i]}`;
      if (BLOCKED_EXTENSIONS.has(hiddenExt)) {
        logger.warn("Double extension attack detected", {
          filename,
          hiddenExtension: hiddenExt,
        });
        return {
          valid: false,
          error: "Invalid filename: potential double extension attack",
        };
      }
    }
  }

  // 3. Check allowed extensions
  const fileExt = lowerFilename.substring(lowerFilename.lastIndexOf("."));
  if (!ALLOWED_EXTENSIONS.has(fileExt)) {
    logger.warn("Disallowed file extension", {
      filename,
      extension: fileExt,
    });
    return {
      valid: false,
      error: `File extension not allowed. Accepted: ${Array.from(
        ALLOWED_EXTENSIONS
      ).join(", ")}`,
    };
  }

  // 4. Validate magic bytes (file-type detection)
  try {
    const fileType = await fileTypeFromBuffer(buffer);

    // CSV/TXT files often have no magic bytes, so fileType may be undefined
    if (fileType) {
      const detectedMime = fileType.mime;

      // Check if detected MIME is allowed
      if (!ALLOWED_MIMES.has(detectedMime)) {
        logger.warn("File content mismatch detected", {
          filename,
          claimedExtension: fileExt,
          detectedMime,
        });
        return {
          valid: false,
          error: `File content does not match expected type. Detected: ${detectedMime}`,
          detectedType: detectedMime,
        };
      }

      return { valid: true, detectedType: detectedMime };
    }

    // For text-based files (CSV, TXT) that don't have magic bytes,
    // we rely on extension validation already done above
    return { valid: true };
  } catch (error) {
    logger.error("File type detection failed", { filename }, error as Error);
    return {
      valid: false,
      error: "Unable to validate file content",
    };
  }
}

/**
 * Express middleware for file validation
 * Use after multer middleware
 */
export function validateUploadMiddleware() {
  return async (
    req: Express.Request & { file?: Express.Multer.File },
    res: Response,
    next: NextFunction
  ) => {
    if (!req.file) {
      return next();
    }

    const result = await validateFileUpload(
      req.file.buffer,
      req.file.originalname
    );

    if (!result.valid) {
      return res.status(400).json({
        success: false,
        error: {
          code: "INVALID_FILE",
          message: result.error,
        },
      });
    }

    next();
  };
}
