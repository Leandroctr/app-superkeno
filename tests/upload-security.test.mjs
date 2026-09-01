import assert from "node:assert/strict";
import { File } from "node:buffer";
import { readFileSync } from "node:fs";
import test from "node:test";

import sharp from "sharp";

import { resolveLegacySplashHtmlUrl } from "../lib/admin-settings-payload.ts";
import {
  assertUploadRequestSize,
  buildStoragePath,
  detectUploadType,
  MAX_UPLOAD_REQUEST_BYTES,
  parseUploadKind,
  prepareImageUpload,
  uploadPolicies,
} from "../lib/upload-security.server.ts";

const routeSource = readFileSync("app/api/admin/upload/route.ts", "utf8");
const helperSource = readFileSync("lib/upload-security.server.ts", "utf8");
const formSource = readFileSync("components/admin-settings-form.tsx", "utf8");

function rejectsWithCode(code) {
  return (error) => {
    assert.equal(error?.name, "UploadValidationError");
    assert.equal(error?.code, code);
    return true;
  };
}

async function makeImageFile(format, name, type) {
  let pipeline = sharp({
    create: {
      width: 16,
      height: 16,
      channels: 4,
      background: { r: 20, g: 80, b: 160, alpha: 1 },
    },
  });

  if (format === "png") {
    pipeline = pipeline.png();
  } else if (format === "jpeg") {
    pipeline = pipeline.jpeg();
  } else {
    pipeline = pipeline.webp();
  }

  const buffer = await pipeline.toBuffer();
  return new File([buffer], name, { type });
}

test("M-3 accepts only the five supported typed kinds", () => {
  for (const kind of ["logo", "favicon", "icon192", "icon512", "splash"]) {
    assert.equal(parseUploadKind(kind), kind);
  }
});

test("M-3 rejects unknown, empty and manipulated kinds", () => {
  for (const kind of ["asset", "", "splashHtml", "LOGO", null, undefined, {}, ["logo"]]) {
    assert.throws(() => parseUploadKind(kind), rejectsWithCode("invalid_kind"));
  }
});

test("M-3 rejects path traversal and strange kind prefixes", () => {
  for (const kind of [
    "../logo",
    "logo/../../admin",
    "logo\\evil",
    "logo%2f..%2fevil",
    "logo?prefix=evil",
    "logo\0evil",
    "💣logo",
  ]) {
    assert.throws(() => parseUploadKind(kind), rejectsWithCode("invalid_kind"));
  }
});

test("M-6 rejects an excessive Content-Length before multipart parsing", () => {
  assert.throws(
    () => assertUploadRequestSize(String(MAX_UPLOAD_REQUEST_BYTES + 1)),
    rejectsWithCode("request_too_large"),
  );
  assert.doesNotThrow(() => assertUploadRequestSize(null));
  assert.doesNotThrow(() => assertUploadRequestSize(String(MAX_UPLOAD_REQUEST_BYTES)));
  assert.throws(
    () => assertUploadRequestSize("not-a-number"),
    rejectsWithCode("invalid_content_length"),
  );

  const guardPosition = routeSource.indexOf("assertUploadRequestSize(");
  const parserPosition = routeSource.indexOf("await request.formData()");
  assert.ok(guardPosition >= 0 && parserPosition > guardPosition);
});

test("M-6 rejects a file above the kind limit before arrayBuffer", async () => {
  let arrayBufferCalled = false;
  const oversizedFile = {
    name: "large.png",
    type: "image/png",
    size: uploadPolicies.favicon.maxBytes + 1,
    async arrayBuffer() {
      arrayBufferCalled = true;
      return new ArrayBuffer(0);
    },
  };

  await assert.rejects(
    () => prepareImageUpload(oversizedFile, "favicon"),
    rejectsWithCode("file_too_large"),
  );
  assert.equal(arrayBufferCalled, false);
});

test("M-4 accepts and fully processes a real PNG", async () => {
  const file = await makeImageFile("png", "logo.png", "image/png");
  const prepared = await prepareImageUpload(file, "logo");

  assert.equal(detectUploadType(prepared.buffer), "png");
  assert.equal(prepared.contentType, "image/png");
  assert.equal(prepared.outputExtension, "png");
  assert.equal(prepared.width, 16);
  assert.equal(prepared.height, 16);
});

test("M-4 accepts real JPEG and WEBP and normalizes icon output to PNG", async () => {
  const jpeg = await makeImageFile("jpeg", "photo.jpg", "image/jpeg");
  const webp = await makeImageFile("webp", "photo.webp", "image/webp");
  const preparedJpeg = await prepareImageUpload(jpeg, "splash");
  const preparedWebp = await prepareImageUpload(webp, "icon192");

  assert.equal(detectUploadType(preparedJpeg.buffer), "jpeg");
  assert.equal(preparedJpeg.contentType, "image/jpeg");
  assert.equal(preparedJpeg.outputExtension, "jpg");
  assert.equal(detectUploadType(preparedWebp.buffer), "png");
  assert.equal(preparedWebp.contentType, "image/png");
  assert.equal(preparedWebp.width, 192);
  assert.equal(preparedWebp.height, 192);
});

test("M-4 rejects a false client MIME", async () => {
  const file = await makeImageFile("png", "logo.png", "image/jpeg");
  await assert.rejects(
    () => prepareImageUpload(file, "logo"),
    rejectsWithCode("mime_mismatch"),
  );
});

test("M-4 rejects a false extension", async () => {
  const file = await makeImageFile("png", "logo.jpg", "image/png");
  await assert.rejects(
    () => prepareImageUpload(file, "logo"),
    rejectsWithCode("extension_mismatch"),
  );
});

test("M-4 rejects content without a supported magic signature", async () => {
  const file = new File([Buffer.from("not an image")], "logo.png", {
    type: "image/png",
  });
  await assert.rejects(
    () => prepareImageUpload(file, "logo"),
    rejectsWithCode("unsupported_type"),
  );
});

test("M-4 rejects a corrupt image and never falls back to original bytes", async () => {
  const corruptPng = Buffer.from([
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00,
  ]);
  const file = new File([corruptPng], "broken.png", { type: "image/png" });

  await assert.rejects(
    () => prepareImageUpload(file, "logo"),
    rejectsWithCode("invalid_image"),
  );
  assert.doesNotMatch(routeSource, /usando original|uploadBuffer\s*=\s*rawBuffer/);
});

test("A-4 rejects SVG, HTML, GIF and ICO content", async () => {
  const cases = [
    new File(["<svg xmlns=\"http://www.w3.org/2000/svg\"><script>alert(1)</script></svg>"], "logo.svg", { type: "image/svg+xml" }),
    new File(["<!doctype html><script>alert(1)</script>"], "splash.html", { type: "text/html" }),
    new File([Buffer.from("GIF89a", "ascii")], "logo.gif", { type: "image/gif" }),
    new File([Buffer.from([0x00, 0x00, 0x01, 0x00, 0x01, 0x00])], "favicon.ico", { type: "image/x-icon" }),
  ];

  assert.equal(detectUploadType(new Uint8Array(await cases[0].arrayBuffer())), "svg");
  assert.equal(detectUploadType(new Uint8Array(await cases[1].arrayBuffer())), "html");
  assert.equal(detectUploadType(new Uint8Array(await cases[2].arrayBuffer())), "gif");
  assert.equal(detectUploadType(new Uint8Array(await cases[3].arrayBuffer())), "ico");

  for (const file of cases) {
    await assert.rejects(
      () => prepareImageUpload(file, "logo"),
      rejectsWithCode("unsupported_type"),
    );
  }

  assert.throws(() => parseUploadKind("splashHtml"), rejectsWithCode("invalid_kind"));
  assert.doesNotMatch(formSource, /accept="[^"]*(?:\.svg|\.ico|\.html)/);
  assert.match(formSource, /Novos uploads HTML foram desativados por seguranca/);
});

test("A-4 freezes legacy splash HTML URLs while allowing preservation or removal", () => {
  const current = "https://storage.example/legacy/splash.html";

  assert.equal(resolveLegacySplashHtmlUrl({}, current), current);
  assert.equal(resolveLegacySplashHtmlUrl({ splashHtmlUrl: current }, current), current);
  assert.equal(resolveLegacySplashHtmlUrl({ splashHtmlUrl: "" }, current), "");
  assert.equal(
    resolveLegacySplashHtmlUrl(
      { splashHtmlUrl: "https://attacker.example/new.html" },
      current,
    ),
    null,
  );
});

test("storage path is restricted to the validated kind and normalized extension", () => {
  const path = buildStoragePath(
    "icon512",
    "Minha Marca FINAL.jpeg",
    "png",
    1700000000000,
    "123e4567-e89b-42d3-a456-426614174000",
  );

  assert.equal(
    path,
    "icon512/1700000000000-123e4567-e89b-42d3-a456-426614174000-minha-marca-final.png",
  );
  assert.equal(path.includes(".."), false);
  assert.throws(
    () => buildStoragePath("logo", "../evil.png", "png"),
    rejectsWithCode("invalid_filename"),
  );
});

test("route keeps authentication before parsing and blocks missing tenant access", () => {
  const authPosition = routeSource.indexOf("await requireTenantAccess()");
  const parserPosition = routeSource.indexOf("await request.formData()");

  assert.ok(authPosition >= 0 && parserPosition > authPosition);
  assert.match(routeSource, /if \(!currentAdmin\)/);
  assert.match(routeSource, /status: 401/);
});

test("successful storage flow uses only the prepared path and keeps public URL generation", () => {
  assert.match(routeSource, /\.upload\(path, uploadData,/);
  assert.match(routeSource, /\.getPublicUrl\(path\)/);
  assert.match(routeSource, /upsert: false/);
  assert.match(routeSource, /contentType: prepared\.contentType/);
  assert.doesNotMatch(routeSource, /`\$\{kind\}\//);
});

test("failure paths use memory only and cannot leave temporary files", () => {
  const combinedSource = `${routeSource}\n${helperSource}`;

  assert.doesNotMatch(combinedSource, /node:fs|from ["']fs["']|writeFile|mkdtemp|tmpdir/);
  assert.match(routeSource, /new Blob\(\[Uint8Array\.from\(prepared\.buffer\)\]/);
});
