import { Component, type ErrorInfo, type ReactNode } from "react";
import { getLocale } from "../lib/i18n";

type Props = { children: ReactNode };
type State = { error: Error | null };

/**
 * Keeps `#root` from going fully blank when a render throw escapes
 * (e.g. Maximum update depth). Sessions remain in localStorage — Reload recovers.
 */
export class AppErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error("[ForkNote] render crash", error, info.componentStack);
  }

  private reload = () => {
    window.location.reload();
  };

  private dismiss = () => {
    this.setState({ error: null });
  };

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;

    const zh = getLocale() === "zh";
    return (
      <div
        className="fn-error-boundary"
        role="alert"
        style={{
          minHeight: "100vh",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          gap: 12,
          padding: 24,
          fontFamily: "var(--fn-ui-font, system-ui, sans-serif)",
          color: "var(--text, #1a1a1a)",
          background: "var(--bg, #fafafa)",
        }}
      >
        <h1 style={{ fontSize: 18, margin: 0 }}>
          {zh ? "界面出错了" : "Something went wrong"}
        </h1>
        <p style={{ margin: 0, maxWidth: 420, textAlign: "center", opacity: 0.8 }}>
          {zh
            ? "笔记仍保存在本机。刷新页面通常即可恢复；若反复出现，请把控制台错误发出来。"
            : "Your notes are still saved locally. Reloading usually restores the UI; if it keeps happening, share the console error."}
        </p>
        <pre
          style={{
            maxWidth: "min(640px, 100%)",
            maxHeight: 120,
            overflow: "auto",
            padding: 12,
            fontSize: 12,
            background: "rgba(0,0,0,0.06)",
            borderRadius: 8,
          }}
        >
          {error.message}
        </pre>
        <div style={{ display: "flex", gap: 8 }}>
          <button type="button" onClick={this.reload}>
            {zh ? "刷新" : "Reload"}
          </button>
          <button type="button" onClick={this.dismiss}>
            {zh ? "重试渲染" : "Try again"}
          </button>
        </div>
      </div>
    );
  }
}
