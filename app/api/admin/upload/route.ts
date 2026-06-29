import { NextResponse } from "next/server";
import { isAdminAuthenticated } from "@/lib/admin-auth";
import { createSupabaseAdminClient } from "@/lib/supabase/server";
import sharp from "sharp";

const bucketName = "app-assets";

const allowedExtensions = new Set(["png", "jpg", "jpeg", "webp", "svg", "ico"]);
const allowedTypes = new Set([
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/svg+xml",
  "image/x-icon",
  "image/vnd.microsoft.icon",
]);

const maxBytesByKind: Record<string, number> = {
  logo: 500 * 1024,
  favicon: 100 * 1024,
  icon192: 300 * 1024,
  icon512: 500 * 1024,
  splash: 1024 * 1024,
  splashHtml: 500 * 1024,
};

// Kinds that go through sharp. splash and splashHtml are excluded.
const optimizedKinds = new Set(["icon192", "icon512", "favicon", "logo"]);

// Extensions that are not processed by sharp (vector / icon container formats).
const bypassSharpExtensions = new Set(["svg", "ico"]);

const pngOptions = { compressionLevel: 9 as const, adaptiveFiltering: true };

function sanitizeFileName(name: string) {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

type OptimizeResult = {
  buffer: Buffer;
  width: number | null;
  height: number | null;
  optimized: boolean;
};

async function optimizeImage(
  input: Buffer,
  kind: string,
  extension: string,
): Promise<OptimizeResult> {
  if (bypassSharpExtensions.has(extension)) {
    return { buffer: input, width: null, height: null, optimized: false };
  }

  let pipeline: ReturnType<typeof sharp>;

  switch (kind) {
    case "icon512":
      pipeline = sharp(input)
        .resize(512, 512, { fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } })
        .png(pngOptions);
      break;

    case "icon192":
      pipeline = sharp(input)
        .resize(192, 192, { fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } })
        .png(pngOptions);
      break;

    case "favicon":
      pipeline = sharp(input)
        .resize(32, 32, { fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } })
        .png(pngOptions);
      break;

    case "logo":
      pipeline = sharp(input)
        .resize(800, undefined, { fit: "inside", withoutEnlargement: true })
        .png(pngOptions);
      break;

    default:
      return { buffer: input, width: null, height: null, optimized: false };
  }

  const optimizedBuffer = await pipeline.toBuffer();
  const meta = await sharp(optimizedBuffer).metadata();

  return {
    buffer: optimizedBuffer,
    width: meta.width ?? null,
    height: meta.height ?? null,
    optimized: true,
  };
}

export async function POST(request: Request) {
  console.log("[UPLOAD] Iniciando upload...");

  if (!(await isAdminAuthenticated())) {
    console.log("[UPLOAD] Erro: não autenticado");
    return NextResponse.json(
      { ok: false, error: "Nao autenticado." },
      { status: 401 },
    );
  }

  const supabase = createSupabaseAdminClient();

  if (!supabase) {
    console.log("[UPLOAD] Erro: Supabase não configurado");
    console.log("[UPLOAD] SUPABASE_URL:", process.env.NEXT_PUBLIC_SUPABASE_URL);
    console.log("[UPLOAD] SERVICE_ROLE_KEY existe:", !!process.env.SUPABASE_SERVICE_ROLE_KEY);
    return NextResponse.json(
      { ok: false, error: "Supabase nao configurado." },
      { status: 503 },
    );
  }

  console.log("[UPLOAD] Supabase client criado com sucesso");

  const formData = await request.formData();
  const file = formData.get("file");
  const kind = String(formData.get("kind") || "asset");

  console.log("[UPLOAD] Kind:", kind);
  console.log(
    "[UPLOAD] File:",
    file instanceof File
      ? `${file.name} (${file.size} bytes, ${file.type})`
      : "não é File",
  );

  if (!(file instanceof File)) {
    return NextResponse.json(
      { ok: false, error: "Arquivo nao enviado." },
      { status: 400 },
    );
  }

  const extension = file.name.split(".").pop()?.toLowerCase() || "";
  const maxBytes = maxBytesByKind[kind] || 500 * 1024;
  const isHtmlSplash = kind === "splashHtml";

  console.log("[UPLOAD] Extension:", extension);
  console.log("[UPLOAD] Max bytes:", maxBytes);
  console.log("[UPLOAD] Is HTML splash:", isHtmlSplash);

  // --- Validate extension/type (unchanged) ---

  if (isHtmlSplash) {
    if (extension !== "html") {
      console.log("[UPLOAD] Erro: formato HTML inválido", extension);
      return NextResponse.json(
        { ok: false, error: "Formato invalido. Envie um arquivo .html." },
        { status: 400 },
      );
    }
  } else {
    if (
      !allowedExtensions.has(extension) ||
      (file.type && !allowedTypes.has(file.type))
    ) {
      console.log("[UPLOAD] Erro: formato inválido", extension, file.type);
      return NextResponse.json(
        { ok: false, error: "Formato invalido. Envie PNG, JPG, WEBP, SVG ou ICO." },
        { status: 400 },
      );
    }
  }

  // --- Optimization pipeline ---

  const originalSizeKb = Math.round(file.size / 1024);
  const shouldOptimize = optimizedKinds.has(kind) && !isHtmlSplash;

  let uploadBuffer: Buffer | null = null;
  let optimized = false;
  let width: number | null = null;
  let height: number | null = null;
  let optimizedSizeKb = originalSizeKb;
  let uploadContentType = isHtmlSplash ? "text/html" : file.type;

  if (shouldOptimize) {
    const rawBuffer = Buffer.from(await file.arrayBuffer());

    try {
      const result = await optimizeImage(rawBuffer, kind, extension);
      uploadBuffer = result.buffer;
      optimized = result.optimized;

      if (optimized) {
        optimizedSizeKb = Math.round(uploadBuffer.length / 1024);
        width = result.width;
        height = result.height;
        uploadContentType = "image/png";
        console.log(
          `[UPLOAD] Otimizado: ${originalSizeKb} KB → ${optimizedSizeKb} KB (${width}x${height})`,
        );
      }
    } catch (err) {
      console.error("[UPLOAD] Erro ao otimizar com sharp — usando original:", err);
      uploadBuffer = rawBuffer;
    }
  }

  // --- Validate size (against optimized buffer when applicable) ---

  const finalSize = uploadBuffer ? uploadBuffer.length : file.size;

  if (finalSize > maxBytes) {
    const errorMsg = optimized
      ? `Imagem otimizada ainda excede o limite de ${Math.round(maxBytes / 1024)} KB.`
      : `Arquivo acima do limite de ${Math.round(maxBytes / 1024)} KB.`;
    console.log("[UPLOAD] Erro: tamanho excedido após otimização", finalSize, ">", maxBytes);
    return NextResponse.json({ ok: false, error: errorMsg }, { status: 400 });
  }

  // --- Build storage path ---

  const safeName = sanitizeFileName(file.name) || `asset.${extension}`;
  const baseName = safeName.replace(/\.[^.]+$/, "");
  const storageName = optimized ? `${baseName}.png` : safeName;
  const path = `${kind}/${Date.now()}-${crypto.randomUUID()}-${storageName}`;

  console.log("[UPLOAD] Path:", path);
  console.log("[UPLOAD] Content-Type:", uploadContentType);
  console.log("[UPLOAD] Enviando para Supabase Storage...");

  // --- Upload ---

  const uploadData: Buffer | File = uploadBuffer ?? file;

  const { error } = await supabase.storage
    .from(bucketName)
    .upload(path, uploadData, {
      cacheControl: "31536000",
      contentType: uploadContentType,
      upsert: false,
    });

  if (error) {
    console.log("[UPLOAD] Erro no Supabase Storage:", JSON.stringify(error));
    return NextResponse.json(
      { ok: false, error: "Nao foi possivel enviar o arquivo." },
      { status: 500 },
    );
  }

  console.log("[UPLOAD] Upload concluído com sucesso!");

  const { data } = supabase.storage.from(bucketName).getPublicUrl(path);

  return NextResponse.json({
    ok: true,
    url: data.publicUrl,
    path,
    originalSizeKb,
    optimizedSizeKb,
    optimized,
    width,
    height,
  });
}
