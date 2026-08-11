import { NextRequest } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { loadTopicIndex } from "@/lib/catalog";
import {
  analyzeMaterial,
  MATERIAL_REJECTION,
  materialStatusFor,
  normalizeDigest,
  tidyText,
} from "@/lib/ai/analyze-material";
import {
  createMaterial,
  finishMaterial,
  loadMaterialParts,
  sweepMaterialFiles,
  MAX_MATERIAL_FILES,
  MAX_PASTED_CHARS,
  MAX_WANT_CHARS,
  type StoredDigest,
} from "@/lib/materials";
import { ipAllowance, materialAllowance } from "@/lib/limits";

export const runtime = "nodejs";
// One multimodal call over up to four files, and nothing after it but two
// writes and a sweep. Shorter than a set build, far past the default.
export const maxDuration = 300;

const BodySchema = z.object({
  /** Storage paths already uploaded by the browser under the caller's prefix. */
  paths: z.array(z.string().min(1)).max(MAX_MATERIAL_FILES).default([]),
  /** Text pasted straight into the form, for material that was never a file. */
  text: z.string().max(MAX_PASTED_CHARS).default(""),
  /** What the student wants next, in their own words. Optional by design. */
  want: z.string().max(MAX_WANT_CHARS).default(""),
});

/**
 * A path that names a file this caller uploaded, and nothing else.
 *
 * The prefix is the same check `/api/scan` makes and for the same reason: the
 * client chooses these strings, and the service client below ignores the
 * storage policies that would otherwise stop one account naming another's
 * files. The traversal check is the part scanning does not need — its paths end
 * in a photo it just wrote, where a material path is worth probing with because
 * a successful read comes back as a readable description.
 */
function ownedPath(path: string, userId: string): boolean {
  return path.startsWith(`${userId}/`) && !path.includes("..") && !path.includes("\\");
}

export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return Response.json({ error: "Not signed in" }, { status: 401 });

  let body;
  try {
    body = BodySchema.parse(await request.json());
  } catch {
    return Response.json({ error: "Invalid request" }, { status: 400 });
  }

  const pasted = body.text.trim();
  if (body.paths.length === 0 && pasted.length === 0) {
    return Response.json({ error: "Add a file or paste some text first." }, { status: 400 });
  }

  // Before the limits, so a caller probing someone else's upload learns nothing
  // about their own quota — the ordering `/api/scan` uses.
  if (!body.paths.every((p) => ownedPath(p, user.id))) {
    return Response.json({ error: "Not found" }, { status: 404 });
  }

  const isAnonymous = user.is_anonymous ?? false;
  const allowance = await materialAllowance(user.id, isAnonymous);
  if (!allowance.ok) return Response.json({ error: allowance.message }, { status: 429 });

  const networkAllowance = await ipAllowance("materials", request.headers);
  if (!networkAllowance.ok) {
    return Response.json({ error: networkAllowance.message }, { status: 429 });
  }

  // The row exists before the call so a failure is still counted. A material
  // that came back unusable spent the same call as one that worked.
  const materialId = await createMaterial(
    user.id,
    body.paths,
    // Stored as typed, for understanding an abusive upload after the fact. It
    // is never read back into a prompt: the call below interprets it once, into
    // closed fields, and that is the only form of it anything downstream sees.
    body.want.trim() || null
  );
  if (!materialId) {
    return Response.json({ error: "Couldn't start reading that. Try again." }, { status: 503 });
  }

  try {
    const [topics, parts] = await Promise.all([
      loadTopicIndex(),
      loadMaterialParts(body.paths),
    ]);
    if (topics.length === 0) {
      await finishMaterial(materialId, "failed", null);
      return Response.json({ error: "Couldn't load the topic list. Try again." }, { status: 503 });
    }
    // Every file dropped out of the sniff, and there was no pasted text to fall
    // back on. Nothing was read, so nothing can be described.
    if (parts.length === 0 && pasted.length === 0) {
      await finishMaterial(materialId, "failed", null);
      return Response.json(
        { error: "Those files weren't readable as photos or PDFs." },
        { status: 400 }
      );
    }

    let raw;
    try {
      raw = await analyzeMaterial({
        topics,
        parts,
        // Tidied on the way in as well as on the way out. The model is told
        // this is data and the digest bounds what can come back, but there is
        // no reason to hand it control characters on top of that.
        pastedText: tidyText(pasted, MAX_PASTED_CHARS),
        want: tidyText(body.want.trim(), MAX_WANT_CHARS),
      });
    } catch {
      // Every model in the chain was rate-limited or overloaded.
      await finishMaterial(materialId, "failed", null);
      return Response.json(
        { error: "Everything's busy right now — try again in a minute." },
        { status: 503 }
      );
    }

    if (!raw) {
      await finishMaterial(materialId, "failed", null);
      return Response.json({ error: "Couldn't read that one." }, { status: 502 });
    }

    const digest: StoredDigest = normalizeDigest(
      raw,
      topics.map((t) => t.id)
    );
    const status = materialStatusFor(digest);
    await finishMaterial(materialId, status, digest);

    if (status !== "ready") {
      // Our copy, keyed off the closed verdict — never the model's own summary,
      // which it wrote immediately after reading content somebody chose.
      return Response.json({ materialId, error: MATERIAL_REJECTION[digest.verdict] }, { status: 422 });
    }
    return Response.json({ materialId });
  } finally {
    // Every path out, not just the successful one. The privacy policy says the
    // file itself is not kept, and a failed analysis is exactly the case that
    // would quietly make that untrue.
    await sweepMaterialFiles(body.paths, materialId);
  }
}
