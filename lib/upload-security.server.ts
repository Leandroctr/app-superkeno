import sharp from "sharp";

export const UPLOAD_KINDS = [
  "logo",
  "favicon",
  "icon192",
  "icon512",
  "splash",
] as const;

export type UploadKind = (typeof UPLOAD_KINDS)[number];
export type SupportedImageType = "png" | "jpeg" | "webp";
export type DetectedUploadType =
  | SupportedImageType
  | "gif"
  | "ico"
  | "svg"
  | "html"
  | "unknown";

type UploadPolicy = {
  maxBytes: number;
  output: "png" | "preserve";
  width?: number;
  height?: number;
};

export const uploadPolicies: Record<UploadKind, UploadPolicy> = {
  logo: { maxBytes: 500 * 1024, output: "png", width: 800 },
  favicon: { maxBytes: 100 * 1024, output: "png", width: 32, height: 32 },
  icon192: { maxBytes: 300 * 1024, output: "png", width: 192, height: 192 },
  icon512: { maxBytes: 500 * 1024, output: "png", width: 512, height: 512 },
  splash: { maxBytes: 1024 * 1024, output: "preserve" },
};

const uploadKindSet = new Set<string>(UPLOAD_KINDS);
const supportedImageTypes = new Set<DetectedUploadType>(["png", "jpeg", "webp"]);
const maxFileBytes = Math.max(...Object.values(uploadPolicies).map(({ maxBytes }) => maxBytes));

export const MAX_MULTIPART_OVERHEAD_BYTES = 64 * 1024;
export const MAX_UPLOAD_REQUEST_BYTES = maxFileBytes + MAX_MULTIPART_OVERHEAD_BYTES;

const extensionsByType: Record<SupportedImageType, ReadonlySet<string>> = {
  png: new Set(["png"]),
  jpeg: new Set(["jpg", "jpeg"]),
  webp: new Set(["webp"]),
};

const mimeByType: Record<SupportedImageType, string> = {
  png: "image/png",
  jpeg: "image/jpeg",
  webp: "image/webp",
};

const outputExtensionByType: Record<SupportedImageType, "png" | "jpg" | "webp"> = {
  png: "png",
  jpeg: "jpg",
  webp: "webp",
};

export type UploadValidationCode =
  | "invalid_content_length"
  | "request_too_large"
  | "invalid_kind"
  | "missing_file"
  | "invalid_filename"
  | "empty_file"
  | "file_too_large"
  | "unsupported_type"
  | "extension_mismatch"
  | "mime_mismatch"
  | "invalid_image";

export class UploadValidationError extends Error {
  code: UploadValidationCode;
  status: number;

  constructor(code: UploadValidationCode, message: string, status = 400) {
    super(message);
    this.name = "UploadValidationError";
    this.code = code;
    this.status = status;
  }
}

export function parseUploadKind(value: unknown): UploadKind {
  if (typeof value !== "string" || !uploadKindSet.has(value)) {
    throw new UploadValidationError(
      "invalid_kind",
      "Tipo de asset invalido.",
    );
  }

  return value as UploadKind;
}

export function assertUploadRequestSize(contentLength: string | null) {
  if (contentLength === null) {
    return;
  }

  if (!/^\d+$/.test(contentLength)) {
    throw new UploadValidationError(
      "invalid_content_length",
      "Content-Length invalido.",
    );
  }

  const parsedLength = Number(contentLength);

  if (!Number.isSafeInteger(parsedLength)) {
    throw new UploadValidationError(
      "invalid_content_length",
      "Content-Length invalido.",
    );
  }

  if (parsedLength > MAX_UPLOAD_REQUEST_BYTES) {
    throw new UploadValidationError(
      "request_too_large",
      `Requisicao acima do limite de ${Math.round(MAX_UPLOAD_REQUEST_BYTES / 1024)} KB.`,
      413,
    );
  }
}

function startsWithBytes(input: Uint8Array, signature: readonly number[]) {
  return (
    input.length >= signature.length &&
    signature.every((byte, index) => input[index] === byte)
  );
}

export function detectUploadType(input: Uint8Array): DetectedUploadType {
  if (startsWithBytes(input, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) {
    return "png";
  }

  if (startsWithBytes(input, [0xff, 0xd8, 0xff])) {
    return "jpeg";
  }

  if (
    input.length >= 12 &&
    String.fromCharCode(...input.subarray(0, 4)) === "RIFF" &&
    String.fromCharCode(...input.subarray(8, 12)) === "WEBP"
  ) {
    return "webp";
  }

  if (
    startsWithBytes(input, [0x47, 0x49, 0x46, 0x38, 0x37, 0x61]) ||
    startsWithBytes(input, [0x47, 0x49, 0x46, 0x38, 0x39, 0x61])
  ) {
    return "gif";
  }

  if (startsWithBytes(input, [0x00, 0x00, 0x01, 0x00])) {
    return "ico";
  }

  const textPrefix = new TextDecoder("utf-8", { fatal: false })
    .decode(input.subarray(0, 4096))
    .replace(/^\uFEFF/, "")
    .trimStart();
  const withoutXmlDeclaration = textPrefix.replace(/^<\?xml\b[^>]*>\s*/i, "");

  if (/^<svg(?:\s|>)/i.test(withoutXmlDeclaration)) {
    return "svg";
  }

  if (/^(?:<!doctype\s+html\b|<html(?:\s|>)|<head(?:\s|>)|<body(?:\s|>)|<script(?:\s|>))/i.test(textPrefix)) {
    return "html";
  }

  return "unknown";
}

function readExtension(fileName: string) {
  const normalizedName = fileName.trim();

  if (
    !normalizedName ||
    normalizedName.length > 200 ||
    /[\\/\0]/.test(normalizedName)
  ) {
    throw new UploadValidationError(
      "invalid_filename",
      "Nome de arquivo invalido.",
    );
  }

  const separator = normalizedName.lastIndexOf(".");

  if (separator <= 0 || separator === normalizedName.length - 1) {
    throw new UploadValidationError(
      "invalid_filename",
      "Arquivo sem extensao valida.",
    );
  }

  return normalizedName.slice(separator + 1).toLowerCase();
}

function validateDeclaredAndDetectedType(
  fileName: string,
  declaredMime: string,
  input: Uint8Array,
): SupportedImageType {
  const detectedType = detectUploadType(input);

  if (!supportedImageTypes.has(detectedType)) {
    throw new UploadValidationError(
      "unsupported_type",
      "Formato nao suportado. Envie PNG, JPEG ou WEBP.",
    );
  }

  const supportedType = detectedType as SupportedImageType;
  const extension = readExtension(fileName);

  if (!extensionsByType[supportedType].has(extension)) {
    throw new UploadValidationError(
      "extension_mismatch",
      "A extensao nao corresponde ao conteudo real do arquivo.",
    );
  }

  if (declaredMime.trim().toLowerCase() !== mimeByType[supportedType]) {
    throw new UploadValidationError(
      "mime_mismatch",
      "O MIME declarado nao corresponde ao conteudo real do arquivo.",
    );
  }

  return supportedType;
}

export type UploadFileLike = {
  name: string;
  size: number;
  type: string;
  arrayBuffer(): Promise<ArrayBuffer>;
};

export type PreparedImageUpload = {
  buffer: Buffer;
  contentType: string;
  outputExtension: "png" | "jpg" | "webp";
  width: number | null;
  height: number | null;
  originalSizeKb: number;
  processedSizeKb: number;
};

const pngOptions = { compressionLevel: 9 as const, adaptiveFiltering: true };
const sharpInputOptions = {
  failOn: "error" as const,
  limitInputPixels: 40_000_000,
  sequentialRead: true,
};

export async function prepareImageUpload(
  file: UploadFileLike,
  kind: UploadKind,
): Promise<PreparedImageUpload> {
  const validatedKind = parseUploadKind(kind);
  const policy = uploadPolicies[validatedKind];

  if (!Number.isSafeInteger(file.size) || file.size <= 0) {
    throw new UploadValidationError("empty_file", "Arquivo vazio ou invalido.");
  }

  if (file.size > policy.maxBytes) {
    throw new UploadValidationError(
      "file_too_large",
      `Arquivo acima do limite de ${Math.round(policy.maxBytes / 1024)} KB.`,
    );
  }

  const input = Buffer.from(await file.arrayBuffer());

  if (input.length === 0 || input.length !== file.size) {
    throw new UploadValidationError("invalid_image", "Arquivo invalido ou incompleto.");
  }

  const detectedType = validateDeclaredAndDetectedType(file.name, file.type, input);

  try {
    let pipeline = sharp(input, sharpInputOptions).rotate();

    if (policy.output === "png") {
      if (policy.height) {
        pipeline = pipeline.resize(policy.width, policy.height, {
          fit: "contain",
          background: { r: 0, g: 0, b: 0, alpha: 0 },
        });
      } else {
        pipeline = pipeline.resize(policy.width, undefined, {
          fit: "inside",
          withoutEnlargement: true,
        });
      }

      pipeline = pipeline.png(pngOptions);
    } else if (detectedType === "png") {
      pipeline = pipeline.png(pngOptions);
    } else if (detectedType === "jpeg") {
      pipeline = pipeline.jpeg();
    } else {
      pipeline = pipeline.webp();
    }

    const result = await pipeline.toBuffer({ resolveWithObject: true });

    if (result.data.length > policy.maxBytes) {
      throw new UploadValidationError(
        "file_too_large",
        `Arquivo processado ainda excede o limite de ${Math.round(policy.maxBytes / 1024)} KB.`,
      );
    }

    const outputType = policy.output === "png" ? "png" : detectedType;

    return {
      buffer: result.data,
      contentType: mimeByType[outputType],
      outputExtension: outputExtensionByType[outputType],
      width: result.info.width ?? null,
      height: result.info.height ?? null,
      originalSizeKb: Math.round(file.size / 1024),
      processedSizeKb: Math.round(result.data.length / 1024),
    };
  } catch (error) {
    if (error instanceof UploadValidationError) {
      throw error;
    }

    throw new UploadValidationError(
      "invalid_image",
      "Imagem invalida, corrompida ou nao decodificavel.",
    );
  }
}

function sanitizeBaseName(fileName: string) {
  const withoutExtension = fileName.replace(/\.[^.]+$/, "");
  return (
    withoutExtension
      .toLowerCase()
      .replace(/[^a-z0-9_-]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 64) || "asset"
  );
}

export function buildStoragePath(
  kind: UploadKind,
  originalName: string,
  outputExtension: PreparedImageUpload["outputExtension"],
  timestamp = Date.now(),
  uuid = crypto.randomUUID(),
) {
  const validatedKind = parseUploadKind(kind);
  readExtension(originalName);

  if (!/^(?:png|jpg|webp)$/.test(outputExtension)) {
    throw new UploadValidationError(
      "invalid_filename",
      "Extensao de destino invalida.",
    );
  }

  const baseName = sanitizeBaseName(originalName);
  return `${validatedKind}/${timestamp}-${uuid}-${baseName}.${outputExtension}`;
}
