import { createServiceClient } from "@/lib/supabase/service";
import type { ImagePart } from "@/lib/ai/provider";
import type { MaterialDigest } from "@/lib/ai/schemas";

/**
 * Study material a student uploaded, and the description it was reduced to.
 *
 * Uploads land in the private `study-materials` bucket under the owner's id,
 * which is what the storage policies key on — the same convention as
 * `worksheet-scans`. Everything here runs server-side with the service client:
 * `status` and `digest` are written after analysis, and a client that could
 * write the digest could write the authoring directives it carries.
 *
 * The one real difference from worksheets is that the files do not survive.
 * A scan is evidence of what a student wrote and is worth keeping; material is
 * whatever they had lying around — a textbook page, a teacher's handout, a
 * photo of a friend's notes — and once the digest exists nothing needs it
 * again. Sweeping immediately is what lets the privacy policy say the file is
 * not kept, rather than that it is kept until they delete it.
 */

export const MATERIAL_BUCKET = "study-materials";

/** At most four files, and no more than this in total across them. */
export const MAX_MATERIAL_FILES = 4;
export const MAX_MATERIAL_BYTES = 20 * 1024 * 1024;

/** How long a pasted excerpt may be before it is truncated. */
export const MAX_PASTED_CHARS = 20_000;

/** What the student may type about what they want next. */
export const MAX_WANT_CHARS = 280;

export type MaterialStatus = "pending" | "ready" | "failed";

/**
 * The digest as persisted.
 *
 * `topic_indices` are resolved to real topic ids before storage. Persisting the
 * indices would mean an old digest silently re-pointing at different topics the
 * next time the catalog is edited, which is the kind of wrong that produces a
 * set on the wrong subject with nothing in the logs to explain it.
 */
export type StoredDigest = Omit<MaterialDigest, "topic_indices"> & {
  topic_ids: string[];
};

export type StudyMaterial = {
  id: string;
  status: MaterialStatus;
  storage_paths: string[];
  digest: StoredDigest | null;
  created_at: string;
};

const MATERIAL_SELECT = "id, status, storage_paths, digest, created_at";

export async function createMaterial(
  userId: string,
  storagePaths: string[],
  want: string | null
): Promise<string | null> {
  const db = createServiceClient();
  const { data, error } = await db
    .from("study_materials")
    .insert({ user_id: userId, storage_paths: storagePaths, want, status: "pending" })
    .select("id")
    .single();
  return error ? null : (data.id as string);
}

export async function finishMaterial(
  materialId: string,
  status: MaterialStatus,
  digest: StoredDigest | null
): Promise<void> {
  const db = createServiceClient();
  await db
    .from("study_materials")
    .update({ status, digest: digest as never })
    .eq("id", materialId);
}

/**
 * What each supported format actually starts with.
 *
 * The bucket's `allowed_mime_types` checks the content type the *uploader*
 * declared, so it bounds an accident rather than an attempt. This reads the
 * bytes, and the mime type sent to the model is the one derived here — never
 * the one attached to the object. `loadScanImages` trusts `blob.type` with a
 * fallback to jpeg, which is fine for a photo an app captured and is not fine
 * for a file someone chose.
 */
function sniffMimeType(bytes: Buffer): string | null {
  if (bytes.length < 12) return null;
  if (bytes.subarray(0, 5).toString("latin1") === "%PDF-") return "application/pdf";
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
  if (bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
    return "image/png";
  }
  if (
    bytes.subarray(0, 4).toString("latin1") === "RIFF" &&
    bytes.subarray(8, 12).toString("latin1") === "WEBP"
  ) {
    return "image/webp";
  }
  // ISO base media: a `ftyp` box whose brand names one of the HEIF flavours.
  if (bytes.subarray(4, 8).toString("latin1") === "ftyp") {
    const brand = bytes.subarray(8, 12).toString("latin1");
    if (["heic", "heix", "heim", "heis", "mif1", "msf1"].includes(brand)) return "image/heic";
    if (["hevc", "hevx", "hevm", "hevs"].includes(brand)) return "image/heif";
  }
  return null;
}

/**
 * Download the uploaded files as base64 parts for the analysis call.
 *
 * A file whose bytes are not one of the formats we accept is skipped rather
 * than failing the upload: the student may have added one stray file to four
 * good ones, and losing the good ones with it helps nobody. Skipping silently
 * is only safe because `analyzeMaterial` is given nothing at all when every
 * file drops out, and the route treats that as a failure the student is told
 * about.
 */
export async function loadMaterialParts(paths: string[]): Promise<ImagePart[]> {
  const db = createServiceClient();
  const out: ImagePart[] = [];
  let total = 0;
  for (const path of paths) {
    const { data, error } = await db.storage.from(MATERIAL_BUCKET).download(path);
    if (error || !data) continue;
    const buffer = Buffer.from(await data.arrayBuffer());
    total += buffer.byteLength;
    if (total > MAX_MATERIAL_BYTES) break;
    const mimeType = sniffMimeType(buffer);
    if (!mimeType) continue;
    out.push({ mimeType, data: buffer.toString("base64") });
  }
  return out;
}

/**
 * Remove the uploaded files and forget where they were.
 *
 * Runs on every path out of analysis, not just the successful one. The privacy
 * policy says the file is not kept, and a failed analysis is exactly the case
 * that would quietly make that false.
 */
export async function sweepMaterialFiles(
  paths: string[],
  materialId: string | null
): Promise<void> {
  if (paths.length === 0) return;
  const db = createServiceClient();
  await db.storage.from(MATERIAL_BUCKET).remove(paths);
  if (materialId) {
    await db.from("study_materials").update({ storage_paths: [] }).eq("id", materialId);
  }
}

export async function getMaterial(
  userId: string,
  materialId: string
): Promise<StudyMaterial | null> {
  const db = createServiceClient();
  const { data } = await db
    .from("study_materials")
    .select(MATERIAL_SELECT)
    .eq("user_id", userId)
    .eq("id", materialId)
    .limit(1);
  return (data?.[0] as StudyMaterial | undefined) ?? null;
}

export async function listMaterials(userId: string, limit = 10): Promise<StudyMaterial[]> {
  const db = createServiceClient();
  const { data } = await db
    .from("study_materials")
    .select(MATERIAL_SELECT)
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(limit);
  return (data as StudyMaterial[] | null) ?? [];
}

/**
 * Every file still stored for one user.
 *
 * Listed from the bucket rather than read out of `study_materials`, for the
 * same reason `scanPathsFor` does it: a file whose row was already removed is
 * still found. There should be almost nothing here, because analysis sweeps as
 * it goes — this is the backstop for an upload that never reached the route at
 * all, which is what a closed tab between the upload and the POST produces.
 *
 * Two levels deep and unpaginated, matching `scanPathsFor`. A third level
 * cannot occur: the browser writes exactly `${userId}/${stamp}/${i}.${ext}`.
 */
export async function materialPathsFor(userId: string): Promise<string[]> {
  const db = createServiceClient();
  const { data: folders } = await db.storage.from(MATERIAL_BUCKET).list(userId);
  const paths: string[] = [];
  for (const folder of folders ?? []) {
    if (folder.id) {
      paths.push(`${userId}/${folder.name}`);
      continue;
    }
    const { data: files } = await db.storage.from(MATERIAL_BUCKET).list(`${userId}/${folder.name}`);
    for (const file of files ?? []) paths.push(`${userId}/${folder.name}/${file.name}`);
  }
  return paths;
}
