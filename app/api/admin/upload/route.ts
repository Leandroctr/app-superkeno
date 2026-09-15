import { NextResponse } from "next/server";
import { createSupabaseAdminClient } from "@/lib/supabase/server";
import { requireTenantAccess } from "@/lib/admin-identity.server";
import { logServerError } from "@/lib/logger/server";
import { sanitizeAssetAuditMetadata } from "@/lib/admin-audit";
import { appConfig } from "@/lib/app-config";
import { extractHostname } from "@/lib/app-settings";
import {
  AdminAuditUnavailableError,
  beginAdminAudit,
  completeAdminAudit,
} from "@/lib/admin-audit.server";
import {
  MultipartUploadError,
  parseMultipartUpload,
} from "@/lib/multipart-upload.server";
import {
  assertUploadRequestSize,
  buildStoragePath,
  MAX_UPLOAD_REQUEST_BYTES,
  parseUploadKind,
  prepareImageUpload,
  UploadValidationError,
} from "@/lib/upload-security.server";

const bucketName = "app-assets";

function validationErrorResponse(
  error: UploadValidationError | MultipartUploadError,
) {
  return NextResponse.json(
    { ok: false, error: error.message, code: error.code },
    { status: error.status },
  );
}

export async function POST(request: Request) {
  const currentAdmin = await requireTenantAccess();

  if (!currentAdmin) {
    return NextResponse.json(
      { ok: false, error: "Nao autenticado." },
      { status: 401 },
    );
  }

  try {
    assertUploadRequestSize(request.headers.get("content-length"));
  } catch (error) {
    if (error instanceof UploadValidationError) {
      return validationErrorResponse(error);
    }

    throw error;
  }

  const contentType = request.headers.get("content-type") || "";

  if (!contentType.toLowerCase().startsWith("multipart/form-data")) {
    return NextResponse.json(
      { ok: false, error: "Envie os dados como multipart/form-data." },
      { status: 400 },
    );
  }

  const supabase = createSupabaseAdminClient();

  if (!supabase) {
    return NextResponse.json(
      { ok: false, error: "Supabase nao configurado." },
      { status: 503 },
    );
  }

  let multipart;
  try {
    multipart = await parseMultipartUpload(request, MAX_UPLOAD_REQUEST_BYTES);
  } catch (error) {
    if (
      error instanceof UploadValidationError ||
      error instanceof MultipartUploadError
    ) {
      return validationErrorResponse(error);
    }

    return NextResponse.json(
      { ok: false, error: "Formulario multipart invalido." },
      { status: 400 },
    );
  }

  try {
    const kind = parseUploadKind(multipart.kind);
    const file = multipart.file;
    const prepared = await prepareImageUpload(file, kind);
    const path = buildStoragePath(
      kind,
      file.name,
      prepared.outputExtension,
    );
    const uploadData = new Blob([Uint8Array.from(prepared.buffer)], {
      type: prepared.contentType,
    });
    const auditMetadata = sanitizeAssetAuditMetadata({
      assetType: kind,
      mimeType: prepared.contentType,
      sizeBytes: prepared.buffer.length,
    });
    let auditContext;

    try {
      auditContext = await beginAdminAudit({
        actor: currentAdmin,
        action: "asset.uploaded",
        entityType: "asset",
        entityId: path,
        targetTenantDomain: extractHostname(appConfig.publicUrl),
        metadataJson: auditMetadata,
      });
    } catch (error) {
      if (error instanceof AdminAuditUnavailableError) {
        return NextResponse.json(
          { ok: false, error: "Auditoria administrativa indisponivel." },
          { status: 503 },
        );
      }
      throw error;
    }

    let storageError;
    try {
      const result = await supabase.storage
        .from(bucketName)
        .upload(path, uploadData, {
          cacheControl: "31536000",
          contentType: prepared.contentType,
          upsert: false,
        });
      storageError = result.error;
    } catch (error) {
      await completeAdminAudit(auditContext, {
        outcome: "failure",
        metadataJson: auditMetadata,
      });
      logServerError("admin_upload_error", error, {
        step: "storage_upload",
      });
      return NextResponse.json(
        { ok: false, error: "Nao foi possivel enviar o arquivo." },
        { status: 500 },
      );
    }

    if (storageError) {
      await completeAdminAudit(auditContext, {
        outcome: "failure",
        metadataJson: auditMetadata,
      });
      logServerError("admin_upload_error", storageError, {
        step: "storage_upload",
      });
      return NextResponse.json(
        { ok: false, error: "Nao foi possivel enviar o arquivo." },
        { status: 500 },
      );
    }

    await completeAdminAudit(auditContext, {
      outcome: "success",
      metadataJson: auditMetadata,
    });
    const { data } = supabase.storage.from(bucketName).getPublicUrl(path);

    return NextResponse.json({
      ok: true,
      url: data.publicUrl,
      path,
      originalSizeKb: prepared.originalSizeKb,
      optimizedSizeKb: prepared.processedSizeKb,
      optimized: true,
      width: prepared.width,
      height: prepared.height,
    });
  } catch (error) {
    if (error instanceof UploadValidationError) {
      return validationErrorResponse(error);
    }

    logServerError("admin_upload_error", error, { step: "process_file" });
    return NextResponse.json(
      { ok: false, error: "Nao foi possivel processar o arquivo." },
      { status: 500 },
    );
  }
}
