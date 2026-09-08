"use client";

import PlatformHeader from '@/components/tools/PlatformHeader';
import '@/components/generator/workspace-theme.css';
import {safeReturnPath} from '@/lib/auth-navigation';
import { useState } from "react";
import { ArrowDown, ArrowRight, Check, Code2, Eye, EyeOff, Layers3, LockKeyhole, ShieldCheck, Sparkles, Workflow } from "lucide-react";

const capabilities = [
  { icon: Sparkles, title: "Start with the idea.", text: "A quick prompt or a detailed brief. Set the scope, the look, and what matters most." },
  { icon: Workflow, title: "Put specialists to work.", text: "Product, design, engineering, and QA coordinate around one mission." },
  { icon: Code2, title: "Make it yours.", text: "Preview the result, request focused changes, inspect the source, and export your code." },
];

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const signIn = async (event: React.FormEvent) => {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/auth/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email, password }) });
      const result = await response.json();
      if (!response.ok) { setError(result.error || "We couldn’t sign you in. Check your email and password."); return; }
      window.location.assign(safeReturnPath(new URLSearchParams(window.location.search).get("next")));
    } catch {
      setError("Connection interrupted. Please try again in a moment.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <><PlatformHeader/><main className="dk-login-surface min-h-screen bg-[#F0EEEA] p-2 text-[#111420] selection:bg-rose-100 sm:p-5 lg:p-8">
      <div className="mx-auto grid max-w-[1380px] overflow-hidden rounded-[26px] border border-slate-300/70 bg-[#FAF8F5] shadow-[0_20px_70px_-30px_rgba(17,20,32,.22)] sm:rounded-[32px] lg:grid-cols-[1.08fr_1fr]">
        <section aria-label="Discover DevKiller" className="relative overflow-hidden px-6 pb-8 pt-7 sm:px-10 sm:pt-8 xl:px-14">
          <div aria-hidden="true" className="pointer-events-none absolute -left-44 top-52 h-[430px] w-[430px] rounded-full bg-[#FF4B72]/[.055] blur-3xl" />
          <header className="relative flex items-center justify-between gap-4">
            <img src="/logoextenso.png" alt="DevKiller" className="h-8 w-auto sm:h-9" />
            <a href="#sign-in" className="flex items-center gap-1.5 text-xs font-semibold text-slate-500 transition hover:text-[#FF4B72] lg:hidden">Sign in <ArrowRight className="h-3.5 w-3.5" /></a>
            <span className="hidden items-center gap-2 text-[10px] font-bold uppercase tracking-[.18em] text-slate-500 sm:inline-flex"><span className="h-1.5 w-1.5 rounded-full bg-[#FF4B72]" />Private workspace</span>
          </header>

          <div className="relative mt-9 max-w-xl lg:mt-10">
            <p className="text-[10px] font-extrabold uppercase tracking-[.23em] text-[#E94366]">Your autonomous development department</p>
            <h1 className="mt-4 text-[clamp(2.5rem,4vw,3.7rem)] font-extrabold leading-[1.04] tracking-[-.065em]">Big idea.<br />Meet your <span className="bg-gradient-to-r from-[#FF4B72] to-[#F97970] bg-clip-text text-transparent">build team.</span></h1>
            <p className="mt-5 max-w-[450px] text-sm leading-6 text-slate-500">Go from “what if” to a working app. DevKiller brings AI specialists, code, and quality checks into one workspace. You bring the direction.</p>
            <a href="#how-it-works" className="mt-4 inline-flex items-center gap-2 text-xs font-bold transition hover:text-[#FF4B72]">See how it comes together <ArrowDown className="h-3.5 w-3.5" /></a>
          </div>

          <div aria-label="The DevKiller workflow: brief, plan, build, and review" className="relative mt-6 rounded-2xl border border-slate-200/60 bg-white/75 p-4 shadow-[0_10px_40px_-24px_rgba(17,20,32,.22)]">
            <div className="mb-4 flex items-center justify-between"><span className="text-[10px] font-bold uppercase tracking-[.16em] text-slate-400">One mission. A coordinated team.</span><Layers3 className="h-4 w-4 text-[#FF4B72]" /></div>
            <ol className="grid grid-cols-4 gap-2">
              {["Your brief", "Plan", "Build", "Review"].map((label, index) => <li key={label} className="min-w-0">
                <div className="mb-2 h-[3px] rounded-full bg-gradient-to-r from-[#FF4B72] to-[#FF6B6B]/30" />
                <span className="text-[9px] font-semibold text-slate-400">0{index + 1}</span>
                <p className="mt-1 text-[11px] font-bold sm:text-xs">{label}</p>
              </li>)}
            </ol>
            <p className="mt-4 border-t border-slate-100 pt-3 text-[11px] leading-5 text-slate-500">Follow the decisions, review the checks, and refine the result.</p>
          </div>

          <div id="how-it-works" className="relative mt-6 scroll-mt-6 space-y-4">
            {capabilities.map(({ icon: Icon, title, text }) => <div key={title} className="flex gap-3.5">
              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl border border-slate-200/70 bg-white/70"><Icon className="h-3.5 w-3.5 text-[#E94366]" /></span>
              <div><h2 className="text-xs font-extrabold">{title}</h2><p className="mt-1 max-w-md text-xs leading-5 text-slate-500">{text}</p></div>
            </div>)}
          </div>
          <footer className="relative mt-6 border-t border-slate-200/70 pt-4">
            <p className="text-[10px] font-bold uppercase tracking-[.16em] text-slate-400">What will you build?</p>
            <div className="mt-3 flex flex-wrap gap-2">
              {["Internal tools", "Event experiences", "Dashboards", "Your next MVP"].map(use => <span key={use} className="rounded-full border border-slate-200 bg-white/50 px-3 py-1.5 text-[10px] font-semibold text-slate-600">{use}</span>)}
            </div>
          </footer>
        </section>

        <section id="sign-in" aria-labelledby="sign-in-title" className="relative flex items-center scroll-mt-4 border-t border-slate-200/70 bg-gradient-to-br from-white via-white to-[#FFF9F8] px-6 py-10 sm:px-10 lg:border-l lg:border-t-0 lg:py-12">
          <div className="w-full">
            <div className="mx-auto w-full max-w-[340px]">
              <span className="inline-flex h-10 w-10 items-center justify-center rounded-xl border border-rose-100 bg-gradient-to-br from-rose-50 to-white"><LockKeyhole className="h-4 w-4 text-[#FF4B72]" strokeWidth={1.7} /></span>
              <p className="mt-5 text-[10px] font-bold uppercase tracking-[.2em] text-slate-400">Less setup. More building.</p>
              <h2 id="sign-in-title" className="mt-3 text-3xl font-extrabold tracking-[-.045em] sm:text-4xl">Welcome back.</h2>
              <p className="mt-3 text-sm leading-6 text-slate-500">Your ideas have a place to go.<br />Sign in to your development workspace.</p>
              <form onSubmit={signIn} className="mt-6 space-y-4">
                <label htmlFor="email" className="block text-xs font-bold text-slate-700">Email address
                  <input id="email" name="email" autoComplete="username" required type="email" placeholder="you@company.com" value={email} onChange={event => setEmail(event.target.value)} className="mt-2.5 w-full rounded-xl border border-slate-200 bg-[#FAFAFA] px-4 py-3.5 text-sm font-normal outline-none transition placeholder:text-slate-400 focus:border-[#FF4B72] focus:bg-white focus:ring-4 focus:ring-rose-50" />
                </label>
                <label htmlFor="password" className="block text-xs font-bold text-slate-700">Password
                  <span className="relative mt-2.5 block">
                    <input id="password" name="password" autoComplete="current-password" required type={showPassword ? "text" : "password"} placeholder="Enter your password" value={password} onChange={event => setPassword(event.target.value)} className="w-full rounded-xl border border-slate-200 bg-[#FAFAFA] py-3.5 pl-4 pr-12 text-sm font-normal outline-none transition placeholder:text-slate-400 focus:border-[#FF4B72] focus:bg-white focus:ring-4 focus:ring-rose-50" />
                    <button type="button" onClick={() => setShowPassword(visible => !visible)} aria-label={showPassword ? "Hide password" : "Show password"} aria-controls="password" title={showPassword ? "Hide password" : "Show password"} className="absolute inset-y-1 right-1 flex w-10 items-center justify-center rounded-lg text-slate-400 transition hover:bg-rose-50 hover:text-[#FF4B72] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#FF4B72]">
                      {showPassword ? <EyeOff className="h-4 w-4" aria-hidden="true" /> : <Eye className="h-4 w-4" aria-hidden="true" />}
                    </button>
                  </span>
                </label>
                {error && <p role="alert" className="rounded-xl bg-rose-50 p-3 text-xs font-semibold leading-5 text-rose-600">{error}</p>}
                <button disabled={busy} className="group flex w-full items-center justify-center gap-3 rounded-xl bg-[#111420] px-4 py-3.5 text-sm font-bold text-white shadow-sm transition hover:bg-[#FF4B72] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[#FF4B72] disabled:cursor-wait disabled:opacity-60">{busy ? "Signing in…" : "Let’s build"}<ArrowRight className="h-4 w-4 transition-transform motion-safe:group-hover:translate-x-1" /></button>
              </form>
              <div className="mt-5 flex items-start gap-2.5 border-t border-slate-100 pt-4">
                <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-slate-400" />
                <p className="text-[11px] leading-5 text-slate-500">DevKiller is currently invite-only. Use the account created through your pilot invitation.</p>
              </div>
              <div className="mt-7 flex items-center justify-center gap-2 text-[10px] text-slate-400"><Check className="h-3 w-3" />Your workspace. Your projects. Your next move.</div>
            </div>
          </div>
        </section>
      </div>
    </main></>
  );
}
