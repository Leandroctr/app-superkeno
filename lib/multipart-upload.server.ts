import { once } from "node:events";
import { finished } from "node:stream/promises";
import busboy from "busboy";

const EXPECTED_FILE_FIELD = "file";
const EXPECTED_KIND_FIELD = "kind";

type MultipartUploadCode =
  | "invalid_content_length"
  | "request_too_large"
  | "invalid_multipart"
  | "missing_file"
  | "invalid_kind";

export class MultipartUploadError extends Error {
  code: MultipartUploadCode;
  status: number;

  constructor(code: MultipartUploadCode, message: string, status = 400) {
    super(message);
    this.name = "MultipartUploadError";
    this.code = code;
    this.status = status;
  }
}

type ParsedUploadFile = {
  name: string;
  size: number;
  type: string;
  arrayBuffer(): Promise<ArrayBuffer>;
};

export type ParsedMultipartUpload = {
  file: ParsedUploadFile;
  kind: string;
};

function invalidMultipart(message = "Formulario multipart invalido.") {
  return new MultipartUploadError("invalid_multipart", message);
}

function requestTooLarge(maxRequestBytes: number) {
  return new MultipartUploadError(
    "request_too_large",
    `Requisicao acima do limite de ${Math.round(maxRequestBytes / 1024)} KB.`,
    413,
  );
}

function toArrayBuffer(buffer: Buffer): ArrayBuffer {
  return Uint8Array.from(buffer).buffer;
}

export async function parseMultipartUpload(
  request: Request,
  maxRequestBytes: number,
): Promise<ParsedMultipartUpload> {
  const contentLength = request.headers.get("content-length");
  if (contentLength !== null) {
    if (!/^\d+$/.test(contentLength)) {
      throw new MultipartUploadError(
        "invalid_content_length",
        "Content-Length invalido.",
      );
    }

    const parsedLength = Number(contentLength);
    if (!Number.isSafeInteger(parsedLength)) {
      throw new MultipartUploadError(
        "invalid_content_length",
        "Content-Length invalido.",
      );
    }

    if (parsedLength > maxRequestBytes) {
      throw requestTooLarge(maxRequestBytes);
    }
  }

  const contentType = request.headers.get("content-type") || "";
  if (!contentType.toLowerCase().startsWith("multipart/form-data")) {
    throw invalidMultipart("Envie os dados como multipart/form-data.");
  }

  if (!request.body) {
    throw invalidMultipart();
  }

  let parser: ReturnType<typeof busboy>;
  try {
    parser = busboy({
      headers: { "content-type": contentType },
      preservePath: true,
      limits: {
        fields: 1,
        files: 1,
        fieldNameSize: 32,
        fieldSize: 64,
        fileSize: maxRequestBytes,
        headerPairs: 32,
      },
    });
  } catch {
    throw invalidMultipart();
  }

  let failure: MultipartUploadError | null = null;
  let kind: string | null = null;
  let fileSeen = false;
  let fileComplete = false;
  let fileName = "";
  let fileMime = "";
  let fileSize = 0;
  const fileChunks: Buffer[] = [];

  const fail = (error: MultipartUploadError) => {
    failure ??= error;
  };

  parser.on("field", (name, value, info) => {
    if (
      name !== EXPECTED_KIND_FIELD ||
      kind !== null ||
      info.nameTruncated ||
      info.valueTruncated
    ) {
      fail(invalidMultipart("Campo multipart inesperado."));
      return;
    }

    kind = value;
  });

  parser.on("file", (name, stream, info) => {
    if (name !== EXPECTED_FILE_FIELD || fileSeen) {
      fail(invalidMultipart("Arquivo multipart inesperado."));
      stream.resume();
      return;
    }

    fileSeen = true;
    fileName = info.filename;
    fileMime = info.mimeType;

    stream.on("limit", () => fail(requestTooLarge(maxRequestBytes)));
    stream.on("data", (chunk: Buffer) => {
      if (failure) {
        return;
      }

      fileSize += chunk.length;
      fileChunks.push(Buffer.from(chunk));
    });
    stream.on("end", () => {
      fileComplete = !stream.truncated;
    });
    stream.on("error", () => fail(invalidMultipart()));
  });

  parser.on("fieldsLimit", () =>
    fail(invalidMultipart("Quantidade de campos multipart excedida.")),
  );
  parser.on("filesLimit", () =>
    fail(invalidMultipart("Apenas um arquivo e permitido.")),
  );
  parser.on("error", () => fail(invalidMultipart()));

  const parserCompletion = finished(parser);
  void parserCompletion.catch(() => undefined);
  const reader = request.body.getReader();
  let bytesRead = 0;

  try {
    while (true) {
      if (failure) {
        throw failure;
      }

      const { done, value } = await reader.read();
      if (done) {
        break;
      }

      bytesRead += value.byteLength;
      if (bytesRead > maxRequestBytes) {
        throw requestTooLarge(maxRequestBytes);
      }

      if (!parser.write(Buffer.from(value))) {
        await once(parser, "drain");
      }

      if (failure) {
        throw failure;
      }
    }

    parser.end();
    await parserCompletion;

    if (failure) {
      throw failure;
    }
  } catch (error) {
    await reader.cancel(error).catch(() => undefined);
    if (!parser.destroyed) {
      parser.destroy();
    }

    if (error instanceof MultipartUploadError) {
      throw error;
    }

    throw invalidMultipart();
  } finally {
    reader.releaseLock();
  }

  if (!fileSeen || !fileComplete) {
    throw new MultipartUploadError("missing_file", "Arquivo nao enviado.");
  }

  if (kind === null) {
    throw new MultipartUploadError("invalid_kind", "Tipo de asset invalido.");
  }

  const buffer = Buffer.concat(fileChunks, fileSize);
  return {
    kind,
    file: {
      name: fileName,
      type: fileMime,
      size: buffer.length,
      async arrayBuffer() {
        return toArrayBuffer(buffer);
      },
    },
  };
}
