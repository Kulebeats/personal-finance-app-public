/**
 * Goals Images Controller
 *
 * Upload and list goal images.
 *
 * @module modules/goals/goals.images.controller
 */

import { randomUUID } from "crypto";
import * as fs from "fs/promises";
import * as path from "path";
import { desc, eq } from "drizzle-orm";
import { Request, Response } from "express";
import { db } from "../../db";
import { goalImageUploads } from "@shared/schema";
import { ValidationError } from "../../core/errors";
import { success, created } from "../../core/http";
import {
  assertAllowedImageContent,
  sanitizeUploadExtension,
} from "../../core/uploads";

const MIME_EXTENSION_MAP: Record<string, string> = {
  "image/jpeg": ".jpg",
  "image/png": ".png",
  "image/webp": ".webp",
};

type ImageUploadRow = typeof goalImageUploads.$inferSelect;

const mapImage = (row: ImageUploadRow) => ({
  id: row.id,
  url: `/${row.filePath.replace(/\\/g, "/")}`,
  originalFilename: row.originalFilename,
  mimeType: row.mimeType,
  fileSize: row.fileSize,
  uploadedAt: row.uploadedAt ? row.uploadedAt.toISOString() : null,
  uploadedBy: row.uploadedBy ?? null,
});

/**
 * GET /api/goals/images
 */
export async function getImages(req: Request, res: Response): Promise<void> {
  const { householdId } = req.householdContext!;

  const images = await db
    .select()
    .from(goalImageUploads)
    .where(eq(goalImageUploads.householdId, householdId))
    .orderBy(desc(goalImageUploads.uploadedAt));

  success(res, images.map(mapImage));
}

/**
 * POST /api/goals/images
 */
export async function uploadImage(req: Request, res: Response): Promise<void> {
  const { householdId, userId } = req.householdContext!;
  const file = (req as Request & { file?: Express.Multer.File }).file;

  if (!file) {
    throw new ValidationError("No file uploaded");
  }

  const ext = sanitizeUploadExtension(file.mimetype, MIME_EXTENSION_MAP);
  await assertAllowedImageContent(file.buffer, Object.keys(MIME_EXTENSION_MAP));

  const storedFilename = `${randomUUID()}${ext}`;
  const directory = path.join("uploads", "goals", householdId);
  const filePath = path.join(directory, storedFilename);

  // SEC-PATH-002: Verify resolved path is within expected directory
  const resolvedPath = path.resolve(filePath);
  const expectedBase = path.resolve("uploads", "goals") + path.sep;
  if (!resolvedPath.startsWith(expectedBase)) {
    throw new ValidationError("Invalid file path");
  }

  await fs.mkdir(directory, { recursive: true });
  await fs.writeFile(filePath, file.buffer);

  const [image] = await db
    .insert(goalImageUploads)
    .values({
      householdId,
      originalFilename: file.originalname,
      storedFilename,
      filePath,
      fileSize: file.size,
      mimeType: file.mimetype,
      uploadedBy: userId,
    })
    .returning();

  created(res, { image: mapImage(image) });
}
