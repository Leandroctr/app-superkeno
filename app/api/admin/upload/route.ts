import { NextResponse } from "next/server";
import { createSupabaseAdminClient } from "@/lib/supabase/server";
import { requireTenantAccess } from "@/lib/admin-identity.server";
import {
  assertUploadRequestSize,
  buildStoragePath,
  parseUploadKind,
  prepareImageUpload,
  UploadValidationError,
} from "@/lib/upload-security.server";

const bucketName = "app-assets";

function validationErrorResponse(error: UploadValidationError) {
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

  let formData: FormData;

  try {
    formData = await request.formData();
  } catch {
    return NextResponse.json(
      { ok: false, error: "Formulario multipart invalido." },
      { status: 400 },
    );
  }

  const file = formData.get("file");

  if (!(file instanceof File)) {
    return validationErrorResponse(
      new UploadValidationError("missing_file", "Arquivo nao enviado."),
    );
  }

  try {
    const kind = parseUploadKind(formData.get("kind"));
    const prepared = await prepareImageUpload(file, kind);
    const path = buildStoragePath(
      kind,
      file.name,
      prepared.outputExtension,
    );
    const uploadData = new Blob([Uint8Array.from(prepared.buffer)], {
      type: prepared.contentType,
    });

    const { error } = await supabase.storage
      .from(bucketName)
      .upload(path, uploadData, {
        cacheControl: "31536000",
        contentType: prepared.contentType,
        upsert: false,
      });

    if (error) {
      console.error("[UPLOAD] Falha no Supabase Storage:", error.message);
      return NextResponse.json(
        { ok: false, error: "Nao foi possivel enviar o arquivo." },
        { status: 500 },
      );
    }

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

    console.error("[UPLOAD] Falha inesperada no processamento do arquivo.", error);
    return NextResponse.json(
      { ok: false, error: "Nao foi possivel processar o arquivo." },
      { status: 500 },
    );
  }
}
