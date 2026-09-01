"use client";

import Image from "next/image";
import { useMemo, useRef, useState } from "react";
import type { ChangeEvent } from "react";
import type { AppSettings } from "@/lib/app-settings";

type AdminSettingsFormProps = {
  initialSettings: AppSettings;
};

type SaveStatus = {
  type: "idle" | "loading" | "success" | "error";
  message: string;
};

type AssetKey = "logoUrl" | "faviconUrl" | "icon192Url" | "icon512Url" | "splashImageUrl" | "splashHtmlUrl";
type AssetKind = "logo" | "favicon" | "icon192" | "icon512" | "splash";

type AssetMeta = {
  fileName: string;
  width?: number;
  height?: number;
  sizeKb: number;
  warning?: string;
};

type AssetConfig = {
  key: AssetKey;
  kind: AssetKind;
  title: string;
  buttonLabel: string;
  recommendation: string;
  ideal: string;
  idealKb: number;
  maxKb: number;
  targetWidth?: number;
  targetHeight?: number;
  aspectRatio?: number;
  template?: {
    width: number;
    height: number;
    name: string;
  };
};

const assetConfigs: AssetConfig[] = [
  {
    key: "logoUrl",
    kind: "logo",
    title: "Logo principal",
    buttonLabel: "Enviar logo",
    recommendation: "Formato recomendado: PNG transparente",
    ideal: "Tamanho ideal: 512x512 px",
    idealKb: 200,
    maxKb: 500,
    targetWidth: 512,
    targetHeight: 512,
    aspectRatio: 1,
  },
  {
    key: "faviconUrl",
    kind: "favicon",
    title: "Favicon",
    buttonLabel: "Enviar favicon",
    recommendation: "Formatos aceitos: PNG, JPEG ou WEBP",
    ideal: "Tamanho ideal: 32x32 px",
    idealKb: 50,
    maxKb: 100,
    targetWidth: 32,
    targetHeight: 32,
    aspectRatio: 1,
  },
  {
    key: "icon192Url",
    kind: "icon192",
    title: "Icone PWA 192",
    buttonLabel: "Enviar icone 192x192",
    recommendation: "Tamanho obrigatorio: 192x192 px",
    ideal: "Usado no manifest do PWA",
    idealKb: 150,
    maxKb: 300,
    targetWidth: 192,
    targetHeight: 192,
    aspectRatio: 1,
    template: { width: 192, height: 192, name: "template-icon-192.png" },
  },
  {
    key: "icon512Url",
    kind: "icon512",
    title: "Icone PWA 512",
    buttonLabel: "Enviar icone 512x512",
    recommendation: "Tamanho obrigatorio: 512x512 px",
    ideal: "Usado para instalacao e icones maskable",
    idealKb: 300,
    maxKb: 500,
    targetWidth: 512,
    targetHeight: 512,
    aspectRatio: 1,
    template: { width: 512, height: 512, name: "template-icon-512.png" },
  },
  {
    key: "splashImageUrl",
    kind: "splash",
    title: "Splash Screen",
    buttonLabel: "Enviar imagem splash",
    recommendation: "Tamanho recomendado: 1080x1920 px",
    ideal: "Imagem vertical para a abertura do app",
    idealKb: 512,
    maxKb: 1024,
    targetWidth: 1080,
    targetHeight: 1920,
    aspectRatio: 1080 / 1920,
    template: { width: 1080, height: 1920, name: "template-splash.png" },
  },
];

const coreFields = [
  {
    key: "appName",
    label: "Nome do aplicativo",
    help: "Esse nome aparecera durante a instalacao do app.",
  },
  {
    key: "appShortName",
    label: "Nome curto",
    help: "Versao compacta exibida no icone instalado.",
  },
  {
    key: "appDescription",
    label: "Descricao",
    help: "Resumo usado em metadados e manifest.",
  },
  {
    key: "platformUrl",
    label: "Link da plataforma",
    help: "Esse endereco sera aberto apos a splash screen.",
  },
  {
    key: "supportUrl",
    label: "Link de suporte",
    help: "Canal de ajuda exibido como opcao secundaria.",
  },
  {
    key: "splashTitle",
    label: "Titulo da splash",
    help: "Texto principal mostrado na abertura do app.",
  },
  {
    key: "splashMessage",
    label: "Mensagem de carregamento",
    help: "Mensagem exibida antes do redirecionamento.",
  },
] as const;

function formatDimension(meta?: AssetMeta) {
  if (!meta?.width || !meta.height) {
    return "Dimensoes nao detectadas";
  }

  return `${meta.width}x${meta.height} px`;
}

function getQuality(config: AssetConfig, sizeKb: number) {
  if (sizeKb <= config.idealKb) {
    return { label: "Excelente", pill: "border border-emerald-200 bg-emerald-50 text-emerald-700" };
  }
  if (sizeKb <= config.maxKb) {
    return { label: "Aceitavel", pill: "border border-amber-200 bg-amber-50 text-amber-700" };
  }
  return { label: "Inaceitavel", pill: "border border-red-200 bg-red-50 text-red-700" };
}

function readImageSize(file: File) {
  return new Promise<{ width?: number; height?: number }>((resolve) => {
    if (file.type === "image/svg+xml") {
      const reader = new FileReader();
      reader.onload = () => {
        const text = String(reader.result || "");
        const width = Number(text.match(/\bwidth=["']?(\d+)/i)?.[1]);
        const height = Number(text.match(/\bheight=["']?(\d+)/i)?.[1]);
        resolve({ width: width || undefined, height: height || undefined });
      };
      reader.onerror = () => resolve({});
      reader.readAsText(file);
      return;
    }

    const url = URL.createObjectURL(file);
    const image = new window.Image();
    image.onload = () => {
      resolve({ width: image.naturalWidth, height: image.naturalHeight });
      URL.revokeObjectURL(url);
    };
    image.onerror = () => {
      resolve({});
      URL.revokeObjectURL(url);
    };
    image.src = url;
  });
}

function buildWarning(config: AssetConfig, meta: AssetMeta) {
  if (!meta.width || !meta.height || !config.targetWidth || !config.targetHeight) {
    return "Nao foi possivel detectar as dimensoes. Confira antes de publicar.";
  }

  if (meta.width !== config.targetWidth || meta.height !== config.targetHeight) {
    return `Imagem enviada: ${meta.width}x${meta.height} px. Recomendado para este campo: ${config.targetWidth}x${config.targetHeight} px.`;
  }

  if (meta.sizeKb > config.maxKb) {
    return `Arquivo acima do tamanho recomendado de ${config.maxKb} KB.`;
  }

  return "";
}

function downloadTemplate(template: NonNullable<AssetConfig["template"]>) {
  const canvas = document.createElement("canvas");
  canvas.width = template.width;
  canvas.height = template.height;
  const context = canvas.getContext("2d");

  if (context) {
    context.fillStyle = "rgba(255,255,255,0)";
    context.fillRect(0, 0, template.width, template.height);
    context.strokeStyle = "#94a3b8";
    context.setLineDash([12, 12]);
    context.strokeRect(8, 8, template.width - 16, template.height - 16);
  }

  const link = document.createElement("a");
  link.download = template.name;
  link.href = canvas.toDataURL("image/png");
  link.click();
}

export function AdminSettingsForm({ initialSettings }: AdminSettingsFormProps) {
  const [settings, setSettings] = useState<AppSettings>(initialSettings);
  const [assetMeta, setAssetMeta] = useState<Partial<Record<AssetKey, AssetMeta>>>({});
  const [uploadingKey, setUploadingKey] = useState<AssetKey | null>(null);
  const [status, setStatus] = useState<SaveStatus>({
    type: "idle",
    message: "",
  });
  const inputRefs = useRef<Partial<Record<AssetKey, HTMLInputElement | null>>>({});

  const appInitial =
    settings.appShortName.trim().charAt(0).toUpperCase() ||
    settings.appName.trim().charAt(0).toUpperCase() ||
    "A";

  const checklist = [
    ["Nome do aplicativo", settings.appName],
    ["URL da plataforma", settings.platformUrl && settings.platformUrl !== "#"],
    ["Logo", settings.logoUrl],
    ["Favicon", settings.faviconUrl],
    ["Icone 192", settings.icon192Url],
    ["Icone 512", settings.icon512Url],
    ["Splash Screen", settings.splashImageUrl],
    ["OneSignal", settings.oneSignalAppId],
    ["Suporte", settings.supportUrl && settings.supportUrl !== "#"],
  ] as const;
  const configuredCount = checklist.filter(([, value]) => Boolean(value)).length;

  const previewStyle = useMemo(
    () => ({
      backgroundColor: settings.backgroundColor || "#f6f7fb",
      backgroundImage: settings.splashImageUrl
        ? `linear-gradient(rgba(246, 247, 251, 0.86), rgba(246, 247, 251, 0.92)), url("${settings.splashImageUrl}")`
        : undefined,
      backgroundPosition: "center",
      backgroundSize: "cover",
      color: "#0f172a",
    }),
    [settings.backgroundColor, settings.splashImageUrl],
  );

  function updateField<Key extends keyof AppSettings>(
    key: Key,
    value: AppSettings[Key],
  ) {
    setSettings((current) => ({
      ...current,
      [key]: value,
    }));
  }

  async function uploadAsset(
    config: AssetConfig,
    event: ChangeEvent<HTMLInputElement>,
  ) {
    const file = event.target.files?.[0];

    if (!file) {
      return;
    }

    setUploadingKey(config.key);
    setStatus({ type: "loading", message: `Enviando ${config.title}...` });

    const size = await readImageSize(file);
    const meta: AssetMeta = {
      fileName: file.name,
      width: size.width,
      height: size.height,
      sizeKb: Math.max(1, Math.round(file.size / 1024)),
    };
    meta.warning = buildWarning(config, meta);

    const formData = new FormData();
    formData.append("kind", config.kind);
    formData.append("file", file);

    const response = await fetch("/api/admin/upload", {
      method: "POST",
      body: formData,
    });
    const result = await response.json().catch(() => null);

    setUploadingKey(null);

    if (!response.ok || !result?.ok) {
      setStatus({
        type: "error",
        message: result?.error || "Nao foi possivel enviar o arquivo.",
      });
      return;
    }

    updateField(config.key, result.url);
    setAssetMeta((current) => ({ ...current, [config.key]: meta }));
    setStatus({
      type: meta.warning ? "success" : "success",
      message: meta.warning || "Arquivo enviado com sucesso.",
    });
    event.target.value = "";
  }

  function removeAsset(config: AssetConfig) {
    updateField(config.key, "");
    setAssetMeta((current) => {
      const next = { ...current };
      delete next[config.key];
      return next;
    });
  }

  function removeHtmlSplash() {
    updateField("splashHtmlUrl", "");
  }

  async function saveSettings() {
    setStatus({ type: "loading", message: "Salvando configuracoes..." });

    const response = await fetch("/api/admin/settings", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(settings),
    });
    const result = await response.json().catch(() => null);

    if (!response.ok || !result?.ok) {
      setStatus({
        type: "error",
        message: result?.error || "Nao foi possivel salvar.",
      });
      return;
    }

    setSettings(result.settings);
    setStatus({
      type: "success",
      message: "Configuracoes salvas com sucesso.",
    });
  }

  return (
    <div className="grid gap-6 xl:grid-cols-[1fr_360px]">
      <section className="grid gap-6">
        <div className="rounded-lg bg-white p-5 shadow-sm">
          <h2 className="text-lg font-black">Identidade do aplicativo</h2>
          <div className="mt-4 grid gap-4 md:grid-cols-2">
            {coreFields.map((field) => (
              <label
                className="grid gap-2 text-sm font-semibold text-slate-700"
                key={field.key}
              >
                {field.label}
                <span className="text-xs font-medium leading-5 text-slate-500">
                  {field.help}
                </span>
                <input
                  className="min-h-11 rounded-lg border border-slate-200 px-3 text-base font-normal outline-none focus:border-slate-400"
                  onChange={(event) => updateField(field.key, event.target.value)}
                  type="text"
                  value={settings[field.key]}
                />
              </label>
            ))}

            <label className="grid gap-2 text-sm font-semibold text-slate-700">
              Cor principal
              <span className="text-xs font-medium leading-5 text-slate-500">
                Utilizada no tema e identidade visual.
              </span>
              <div className="flex gap-2">
                <input
                  className="h-11 w-14 rounded-lg border border-slate-200 bg-white"
                  onChange={(event) => updateField("themeColor", event.target.value)}
                  type="color"
                  value={settings.themeColor || "#101828"}
                />
                <input
                  className="min-h-11 flex-1 rounded-lg border border-slate-200 px-3 text-base font-normal outline-none focus:border-slate-400"
                  onChange={(event) => updateField("themeColor", event.target.value)}
                  type="text"
                  value={settings.themeColor}
                />
              </div>
            </label>

            <label className="grid gap-2 text-sm font-semibold text-slate-700">
              Cor de fundo
              <span className="text-xs font-medium leading-5 text-slate-500">
                Aplicada na splash e nas telas administrativas.
              </span>
              <div className="flex gap-2">
                <input
                  className="h-11 w-14 rounded-lg border border-slate-200 bg-white"
                  onChange={(event) =>
                    updateField("backgroundColor", event.target.value)
                  }
                  type="color"
                  value={settings.backgroundColor || "#f6f7fb"}
                />
                <input
                  className="min-h-11 flex-1 rounded-lg border border-slate-200 px-3 text-base font-normal outline-none focus:border-slate-400"
                  onChange={(event) =>
                    updateField("backgroundColor", event.target.value)
                  }
                  type="text"
                  value={settings.backgroundColor}
                />
              </div>
            </label>

            <label className="grid gap-2 text-sm font-semibold text-slate-700">
              Tempo antes de abrir o site
              <span className="text-xs font-medium leading-5 text-slate-500">
                Tempo em milissegundos.
              </span>
              <input
                className="min-h-11 rounded-lg border border-slate-200 px-3 text-base font-normal outline-none focus:border-slate-400"
                min={0}
                onChange={(event) =>
                  updateField("redirectDelayMs", Number(event.target.value))
                }
                type="number"
                value={settings.redirectDelayMs}
              />
            </label>

            <label className="grid gap-2 text-sm font-semibold text-slate-700">
              OneSignal App ID
              <span className="text-xs font-medium leading-5 text-slate-500">
                Necessario apenas se notificacoes estiverem ativas.
              </span>
              <input
                className="min-h-11 rounded-lg border border-slate-200 px-3 text-base font-normal outline-none focus:border-slate-400"
                onChange={(event) =>
                  updateField("oneSignalAppId", event.target.value)
                }
                type="text"
                value={settings.oneSignalAppId}
              />
            </label>

            <label className="flex items-center gap-3 rounded-lg border border-slate-200 px-3 py-3 text-sm font-semibold text-slate-700">
              <input
                checked={settings.notificationsEnabled}
                className="size-4"
                onChange={(event) =>
                  updateField("notificationsEnabled", event.target.checked)
                }
                type="checkbox"
              />
              Notificacoes ativas
            </label>
          </div>
        </div>

        <div className="rounded-lg bg-white p-5 shadow-sm">
          <h2 className="text-lg font-black">Ativos visuais</h2>
          <div className="mt-4 grid gap-4 lg:grid-cols-2">
            {assetConfigs.map((config) => {
              const url = settings[config.key];
              const meta = assetMeta[config.key];
              const quality = meta ? getQuality(config, meta.sizeKb) : null;

              return (
                <section
                  className="grid gap-4 rounded-lg border border-slate-200 p-4"
                  key={config.key}
                >
                  <div>
                    <h3 className="text-base font-black">{config.title}</h3>
                    <p className="mt-1 text-sm leading-6 text-slate-500">
                      {config.recommendation}. {config.ideal}. Ideal: até{" "}
                      {config.idealKb} KB • Máximo: {config.maxKb} KB.
                    </p>
                  </div>

                  {url ? (
                    <div className="flex items-start gap-3">
                      <div className="grid size-20 shrink-0 place-items-center overflow-hidden rounded-lg border border-slate-200 bg-slate-50">
                        <Image
                          alt={config.title}
                          className="max-h-20 max-w-20 object-contain"
                          height={80}
                          src={url}
                          unoptimized
                          width={80}
                        />
                      </div>
                      <div className="min-w-0 text-sm text-slate-600">
                        {meta ? (
                          <>
                            <p className="truncate font-semibold text-slate-900">
                              {meta.fileName}
                            </p>
                            <p className="mt-0.5">{meta.sizeKb} KB</p>
                            <span
                              className={`mt-1.5 inline-block rounded-full px-2.5 py-0.5 text-xs font-bold ${quality!.pill}`}
                            >
                              {quality!.label}
                            </span>
                            {meta.warning ? (
                              <p className="mt-2 rounded-lg bg-amber-50 px-3 py-2 font-medium text-amber-900">
                                {meta.warning}
                              </p>
                            ) : null}
                          </>
                        ) : (
                          <p className="font-semibold text-slate-900">
                            Arquivo configurado
                          </p>
                        )}
                      </div>
                    </div>
                  ) : (
                    <p className="rounded-lg bg-slate-50 px-3 py-3 text-sm font-medium text-slate-500">
                      Nenhum arquivo enviado ainda.
                    </p>
                  )}

                  <div className="flex flex-wrap gap-2">
                    <input
                      accept=".png,.jpg,.jpeg,.webp,image/png,image/jpeg,image/webp"
                      className="hidden"
                      onChange={(event) => uploadAsset(config, event)}
                      ref={(element) => {
                        inputRefs.current[config.key] = element;
                      }}
                      type="file"
                    />
                    <button
                      className="min-h-10 rounded-lg px-4 text-sm font-bold text-white disabled:cursor-not-allowed disabled:opacity-70"
                      disabled={uploadingKey === config.key}
                      onClick={() => inputRefs.current[config.key]?.click()}
                      style={{ backgroundColor: settings.themeColor || "#101828" }}
                      type="button"
                    >
                      {uploadingKey === config.key
                        ? "Enviando..."
                        : url
                          ? "Substituir arquivo"
                          : config.buttonLabel}
                    </button>
                    {url ? (
                      <button
                        className="min-h-10 rounded-lg border border-slate-200 px-4 text-sm font-bold text-slate-700"
                        onClick={() => removeAsset(config)}
                        type="button"
                      >
                        Remover
                      </button>
                    ) : null}
                    {config.template ? (
                      <button
                        className="min-h-10 rounded-lg border border-slate-200 px-4 text-sm font-bold text-slate-700"
                        onClick={() => downloadTemplate(config.template!)}
                        type="button"
                      >
                        Baixar modelo
                      </button>
                    ) : null}
                  </div>
                </section>
              );
            })}


            <section className="grid gap-4 rounded-lg border border-slate-200 p-4">
              <div>
                <h3 className="text-base font-black">Splash Animada (HTML)</h3>
                <p className="mt-1 text-sm leading-6 text-slate-500">
                  Novos uploads HTML foram desativados por seguranca. Uma splash
                  legada ja configurada continua ativa ate ser removida; para novas
                  configuracoes, use a imagem de splash.
                </p>
              </div>

              {settings.splashHtmlUrl ? (
                <div className="rounded-lg bg-slate-50 px-3 py-3 text-sm text-slate-700">
                  <p className="font-semibold text-slate-900">
                    Arquivo HTML legado configurado
                  </p>
                  <p className="mt-1 font-semibold text-emerald-700">Ativa — tem prioridade sobre a imagem</p>
                </div>
              ) : (
                <p className="rounded-lg bg-slate-50 px-3 py-3 text-sm font-medium text-slate-500">
                  Nenhum arquivo HTML enviado. A splash estatica sera usada.
                </p>
              )}

              <div className="flex flex-wrap gap-2">
                {settings.splashHtmlUrl ? (
                  <button
                    className="min-h-10 rounded-lg border border-slate-200 px-4 text-sm font-bold text-slate-700"
                    onClick={removeHtmlSplash}
                    type="button"
                  >
                    Remover
                  </button>
                ) : null}
              </div>
            </section>
          </div>
        </div>

        <details className="rounded-lg bg-white p-5 shadow-sm">
          <summary className="cursor-pointer text-lg font-black">
            Configuracao avancada por URL
          </summary>
          <div className="mt-4 grid gap-4 md:grid-cols-2">
            {assetConfigs.map((config) => (
              <label
                className="grid gap-2 text-sm font-semibold text-slate-700"
                key={config.key}
              >
                {config.title}
                <input
                  className="min-h-11 rounded-lg border border-slate-200 px-3 text-base font-normal outline-none focus:border-slate-400"
                  onChange={(event) => updateField(config.key, event.target.value)}
                  type="text"
                  value={settings[config.key]}
                />
              </label>
            ))}
            <label className="grid gap-2 text-sm font-semibold text-slate-700">
              URL publica
              <input
                className="min-h-11 rounded-lg border border-slate-200 px-3 text-base font-normal outline-none focus:border-slate-400"
                onChange={(event) => updateField("publicUrl", event.target.value)}
                type="text"
                value={settings.publicUrl}
              />
            </label>
          </div>
        </details>

        <div className="rounded-lg bg-white p-5 shadow-sm">
          <div className="flex flex-wrap items-center gap-3">
            <button
              className="min-h-11 rounded-lg px-5 text-sm font-bold text-white disabled:cursor-not-allowed disabled:opacity-70"
              disabled={status.type === "loading"}
              onClick={saveSettings}
              style={{ backgroundColor: settings.themeColor || "#101828" }}
              type="button"
            >
              {status.type === "loading" ? "Salvando..." : "Salvar configuracoes"}
            </button>

            {status.message ? (
              <p
                className={
                  status.type === "error"
                    ? "text-sm font-semibold text-red-700"
                    : "text-sm font-semibold text-emerald-700"
                }
              >
                {status.message}
              </p>
            ) : null}
          </div>
        </div>
      </section>

      <aside className="grid gap-6 self-start">
        <section className="rounded-lg bg-white p-5 shadow-sm">
          <h2 className="text-lg font-black">Status da Configuracao</h2>
          <p className="mt-2 text-sm font-bold text-slate-600">
            {configuredCount}/9 configurado
          </p>
          <div className="mt-4 grid gap-2">
            {checklist.map(([label, value]) => (
              <p
                className={
                  value
                    ? "text-sm font-semibold text-emerald-700"
                    : "text-sm font-semibold text-slate-400"
                }
                key={label}
              >
                {value ? "✓" : "•"} {label}
              </p>
            ))}
          </div>
        </section>

        <section className="rounded-lg bg-white p-5 shadow-sm">
          <h2 className="mb-4 text-lg font-black">Previa da splash</h2>
          {settings.splashHtmlUrl ? (
            <div className="mb-3 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm font-semibold text-emerald-800">
              Splash HTML ativa — o HTML animado sera exibido no lugar desta previa.{" "}
              <a
                className="underline"
                href={settings.splashHtmlUrl}
                rel="noopener noreferrer"
                target="_blank"
              >
                Ver HTML
              </a>
            </div>
          ) : null}
          <div
            className="grid min-h-96 place-items-center rounded-lg px-5 py-8 text-center"
            style={previewStyle}
          >
            <div className="flex max-w-xs flex-col items-center">
              {settings.logoUrl ? (
                <Image
                  alt={`${settings.appName} logo`}
                  className="size-20 rounded-3xl object-cover shadow-xl shadow-slate-900/15"
                  height={80}
                  src={settings.logoUrl}
                  unoptimized
                  width={80}
                />
              ) : (
                <div
                  className="grid size-20 place-items-center rounded-3xl text-3xl font-bold text-white shadow-xl shadow-slate-900/15"
                  style={{ backgroundColor: settings.themeColor || "#101828" }}
                >
                  {appInitial}
                </div>
              )}

              <h3 className="mt-6 text-2xl font-bold tracking-normal">
                {settings.splashTitle || settings.appName}
              </h3>
              <p className="mt-3 text-sm font-medium leading-6 text-slate-600">
                {settings.splashMessage || "Carregando ambiente seguro..."}
              </p>
              <div
                aria-hidden="true"
                className="mt-7 size-9 rounded-full border-4 border-slate-200"
                style={{ borderTopColor: settings.themeColor || "#101828" }}
              />
              <button
                className="mt-8 rounded-full px-5 py-2.5 text-sm font-bold text-white shadow-lg shadow-slate-900/15"
                style={{ backgroundColor: settings.themeColor || "#101828" }}
                type="button"
              >
                Abrir agora
              </button>
            </div>
          </div>
        </section>
      </aside>
    </div>
  );
}
