/**
 * Put the files a student chose into a private bucket, from the browser.
 *
 * Both uploaders — worksheet scans and study materials — do exactly this, and
 * for the same two reasons. The upload goes direct so several megabytes of
 * photo never enter a serverless request body, and every object is keyed under
 * `${userId}/...` because that prefix is what the storage policies check. The
 * route is then told only which paths to read.
 *
 * The Supabase client and `ensureUser` are `await import`ed here rather than
 * imported at the top, which is what keeps the auth SDK out of the initial
 * bundle of every page that renders an uploader — this module is in their
 * static graph, the SDK is not.
 */
export async function uploadToBucket(
  bucket: string,
  files: File[],
  fallbackExt = "bin"
): Promise<string[]> {
  const [{ createClient }, { ensureUser }] = await Promise.all([
    import("@/lib/supabase/client"),
    import("@/lib/auth"),
  ]);
  const user = await ensureUser();
  const supabase = createClient();

  // One uuid per batch, so the pages of a single upload stay together and can
  // be swept as a group. Not upsert: the stamp makes each path unique by
  // construction, and the buckets have insert/read/delete policies but no
  // update — an overwrite would fail the policy rather than the check.
  const stamp = crypto.randomUUID();
  const paths: string[] = [];
  for (const [i, file] of files.entries()) {
    const ext = (file.name.split(".").pop() ?? fallbackExt).toLowerCase();
    const path = `${user.id}/${stamp}/${i}.${ext}`;
    const { error } = await supabase.storage
      .from(bucket)
      .upload(path, file, { contentType: file.type });
    if (error) throw new Error("That upload didn't go through — check your connection.");
    paths.push(path);
  }
  return paths;
}
