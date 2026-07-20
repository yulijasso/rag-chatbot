import { type HandleUploadBody, handleUpload } from "@vercel/blob/client";
import { type NextRequest, NextResponse } from "next/server";
import { requireOrgContext } from "@/lib/auth/org";

/**
 * Client-upload token endpoint for large files.
 *
 * The browser uploads the file straight to Vercel Blob (bypassing the ~10MB
 * request-body limit) and calls here to mint a scoped upload token. We just
 * authenticate and constrain size/type; the actual extract+embed happens in
 * /api/ingest once the client hands us back the blob URL. (We don't rely on
 * onUploadCompleted because that webhook never fires on localhost.)
 */
export async function POST(request: NextRequest) {
  const body = (await request.json()) as HandleUploadBody;

  try {
    const result = await handleUpload({
      body,
      request,
      onBeforeGenerateToken: async () => {
        // Throws if the caller isn't signed in / has no org.
        await requireOrgContext();
        return {
          allowedContentTypes: [
            "application/pdf",
            "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
            "text/plain",
            "text/markdown",
            "application/octet-stream",
          ],
          maximumSizeInBytes: 100 * 1024 * 1024, // 100MB
          // Give every upload a unique path so re-uploading the same filename
          // (or two tenants uploading the same name) never collides.
          addRandomSuffix: true,
        };
      },
      onUploadCompleted: async () => {
        // Intentionally empty — ingestion is triggered by the client.
      },
    });
    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Upload failed" },
      { status: 400 }
    );
  }
}
