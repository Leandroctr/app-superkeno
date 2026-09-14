"use client";

import Image from "next/image";
import { useActionState } from "react";
import {
  beginMfaEnrollment,
  verifyMfaCode,
  type MfaActionState,
} from "./actions";

type VerifiedFactor = {
  id: string;
  friendlyName: string | null;
};

type MfaFormProps =
  | { mode: "enrollment"; verifiedFactors?: never }
  | { mode: "challenge"; verifiedFactors: VerifiedFactor[] };

const initialState: MfaActionState = { status: "idle" };

function CodeForm({ factorId }: { factorId: string }) {
  const [state, action, pending] = useActionState(
    verifyMfaCode,
    initialState,
  );

  return (
    <form action={action} className="grid gap-4">
      <input name="factorId" type="hidden" value={factorId} />
      <label className="grid gap-2 text-sm font-semibold text-slate-700">
        Codigo do autenticador
        <input
          autoComplete="one-time-code"
          className="min-h-12 rounded-lg border border-slate-200 px-3 text-center font-mono text-xl tracking-[0.3em] outline-none focus:border-slate-400"
          inputMode="numeric"
          maxLength={6}
          minLength={6}
          name="code"
          pattern="[0-9]{6}"
          required
          type="text"
        />
      </label>
      <button
        className="min-h-12 rounded-lg bg-slate-950 px-4 text-base font-bold text-white disabled:cursor-wait disabled:opacity-60"
        disabled={pending}
        type="submit"
      >
        {pending ? "Verificando..." : "Confirmar codigo"}
      </button>
      {state.status === "error" ? (
        <p className="rounded-lg bg-red-50 px-3 py-2 text-sm font-medium text-red-800">
          {state.message}
        </p>
      ) : null}
    </form>
  );
}

function EnrollmentForm() {
  const [state, action, pending] = useActionState(
    beginMfaEnrollment,
    initialState,
  );

  if (state.status === "ready" && state.factorId && state.qrCode && state.secret) {
    return (
      <div className="grid gap-5">
        <div className="grid justify-items-center gap-3 rounded-lg border border-slate-200 p-4">
          <Image
            alt="QR code para configurar o autenticador"
            height={240}
            src={state.qrCode}
            unoptimized
            width={240}
          />
          <p className="text-center text-sm text-slate-600">
            Escaneie o QR code no aplicativo autenticador. Se necessario,
            informe manualmente o segredo abaixo.
          </p>
          <code className="max-w-full break-all rounded bg-slate-100 px-3 py-2 text-center text-sm font-semibold text-slate-900">
            {state.secret}
          </code>
        </div>
        <CodeForm factorId={state.factorId} />
      </div>
    );
  }

  return (
    <form action={action} className="grid gap-4">
      <p className="text-sm leading-6 text-slate-600">
        Configure um aplicativo autenticador para proteger toda sessao
        administrativa deste usuario.
      </p>
      <button
        className="min-h-12 rounded-lg bg-slate-950 px-4 text-base font-bold text-white disabled:cursor-wait disabled:opacity-60"
        disabled={pending}
        type="submit"
      >
        {pending ? "Preparando..." : "Configurar autenticador"}
      </button>
      {state.status === "error" ? (
        <p className="rounded-lg bg-red-50 px-3 py-2 text-sm font-medium text-red-800">
          {state.message}
        </p>
      ) : null}
    </form>
  );
}

export function MfaForm(props: MfaFormProps) {
  if (props.mode === "enrollment") {
    return <EnrollmentForm />;
  }

  const [firstFactor, ...additionalFactors] = props.verifiedFactors;

  if (!firstFactor) {
    return null;
  }

  return (
    <div className="grid gap-4">
      <p className="text-sm leading-6 text-slate-600">
        Digite o codigo atual do seu aplicativo autenticador para liberar o
        painel administrativo.
      </p>
      {additionalFactors.length === 0 ? (
        <CodeForm factorId={firstFactor.id} />
      ) : (
        <div className="grid gap-5">
          {[firstFactor, ...additionalFactors].map((factor, index) => (
            <section
              className="grid gap-3 border-t border-slate-100 pt-4 first:border-0 first:pt-0"
              key={factor.id}
            >
              <p className="text-sm font-semibold text-slate-700">
                {factor.friendlyName || `Autenticador ${index + 1}`}
              </p>
              <CodeForm factorId={factor.id} />
            </section>
          ))}
        </div>
      )}
    </div>
  );
}
