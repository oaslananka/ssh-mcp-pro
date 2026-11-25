import { DASHBOARD_BRAND_FINGERPRINT } from "./web-dashboard-brand.js";

export const DASHBOARD_PAGE_RENDER_SCRIPT = `    function renderLanding() {
      return \`
        <div class="landing-shell">
          <section class="landing-hero">
            <div class="landing-copy">
              <div class="eyebrow"><span class="mini-spark" aria-hidden="true"></span> ZERO-TRUST SSH CONTROL PLANE · MCP SERVER</div>
              <h1>Your machines. <em>Inside your AI chat.</em></h1>
              <p>Connect your workstations and servers to ChatGPT, Claude or Gemini with strict SSH Model Context Protocol access. Strict host-key checking, non-root enforcement, and tamper-evident audit logs.</p>
              <div class="auth-buttons">
                <a href="/auth/login/google" class="auth-btn auth-btn-google">
                  <span class="google-icon" aria-hidden="true">G</span> Continue with Google
                </a>
                <a href="/auth/login/github" class="auth-btn auth-btn-github">
                  <span class="github-icon" aria-hidden="true">⌘</span> Continue with GitHub
                </a>
              </div>
              <div class="landing-specs" aria-label="Security specifications">
                <span class="spec-pill"><span class="spec-dot" aria-hidden="true"></span>Strict host-key check</span>
                <span class="spec-pill"><span class="spec-dot" aria-hidden="true"></span>Non-root isolation</span>
                <span class="spec-pill"><span class="spec-dot" aria-hidden="true"></span>Zero sudo default</span>
                <span class="spec-pill"><span class="spec-dot" aria-hidden="true"></span>SHA-256 audit chaining</span>
              </div>
              <p class="landing-small-note">Already connected a device? Sign in with the same account to find it.</p>
              <p id="providerSetup" class="device-scope-note" role="status" hidden>Local sign-in is not configured yet. Configure a supported OAuth provider or use the <a href="https://ssh-mcp-pro.oaslananka.dev/">hosted dashboard</a>.</p>
            </div>
            <div class="product-stage" aria-label="Illustration of ssh-mcp-pro connecting AI clients to your device. Not a live session.">
              <div class="stage-overline">WORK WITH YOUR FAVORITE ASSISTANT</div>
              <div class="stage-clients">
                <div class="assistant-chip"><span class="assistant-mark gpt-mark" aria-hidden="true">✳</span> ChatGPT<span class="chip-status">OpenAI MCP</span></div>
                <div class="assistant-chip"><span class="assistant-mark claude-mark" aria-hidden="true">✺</span> Claude<span class="chip-status">Desktop &amp; Web</span></div>
                <div class="assistant-chip"><span class="assistant-mark gemini-mark" aria-hidden="true">✦</span> Gemini<span class="chip-status">CLI &amp; Custom Apps</span></div>
              </div>
              <div class="stage-connector" aria-hidden="true"><span></span><i></i><span></span></div>
              <div class="stage-gateway">
                <img src="/brand/ssh-mcp-pro-icon.png?v=${DASHBOARD_BRAND_FINGERPRINT}" width="64" height="64" alt="" aria-hidden="true">
                <div><strong>ssh-mcp-pro</strong><small>One secure connection. Your rules.</small></div>
                <span class="stage-shield" aria-label="Policy controlled">✓</span>
              </div>
              <div class="stage-connector short" aria-hidden="true"><span></span><i></i><span></span></div>
              <div class="terminal-preview" role="region" aria-label="Interactive terminal preview">
                <div class="terminal-titlebar"><span class="terminal-host-badge"><i aria-hidden="true"></i> srv-prod-01 (Ubuntu 24.04 LTS)</span><span class="terminal-policy-badge">STRICT ENFORCE</span><span class="terminal-sample">Illustrative preview</span></div>
                <div class="terminal-content">
                  <div class="terminal-line"><span class="terminal-caller">claude</span><span class="terminal-dollar" aria-hidden="true">›</span> <span class="term-fn">proc_exec</span>(<span class="term-arg">"systemctl is-active docker"</span>)</div>
                  <div class="terminal-result"><span class="mini-spark" aria-hidden="true"></span> [policy-guard] rule: <span class="term-hl">allow-read-only</span> · exit 0</div>
                  <div class="terminal-output">active (running) · 4 containers up</div>
                  <div class="terminal-caption">Run only what your access policy allows. Chained in audit log.</div>
                </div>
              </div>
            </div>
          </section>
          <section class="onboarding-section" aria-labelledby="start-heading">
            <div class="onboarding-section-head"><p class="eyebrow">INTEGRATION FLOW</p><h2 id="start-heading">Quick start: three steps to connected.</h2><p>Zero daemon compile required. Start from sign-in to verified AI execution in three minutes.</p></div>
            <div class="onboarding-steps">
              <article><span class="step-number">01</span><h3>Authenticate workspace</h3><p>Sign in with Google or GitHub to create an isolated cryptographic workspace with automatic keypair generation.</p></article>
              <article><span class="step-number">02</span><h3>Enroll host daemon</h3><p>Install the lightweight agent on your Windows, Linux, or macOS machine. Choose exact scope policies.</p></article>
              <article><span class="step-number">03</span><h3>Connect AI assistant</h3><p>Use the secure MCP endpoint from ChatGPT, Claude or Gemini and start working.</p></article>
            </div>
          </section>
          <section class="landing-local"><div><span class="landing-local-symbol" aria-hidden="true">⌘</span><div><h2>Prefer to stay local?</h2><p>Start your own local dashboard. Sign-in requires a Google or GitHub OAuth provider.</p></div></div><code>npx -y ssh-mcp-pro web</code></section>
        </div>
      \`;
    }

    function renderTabContent() {
      if (activeTab === 'usage') return renderUsagePanel();

      if (activeTab === 'devices') {
        if (!devicesLoaded) {
          return '<div class="card device-loading" role="status">Loading your connected devices…</div>';
        }
        if (devicesError) {
          return '<div class="card feedback-error" role="alert"><h2>Could not load your devices</h2><p>Check your internet connection and try again. Your existing devices and permissions have not been changed.</p><button type="button" class="btn btn-primary" onclick="retryDevices()">Try again</button></div>';
        }
        if (devicesList.length === 0) {
          return \`<div class="card empty-box onboarding-empty">
            <div class="empty-art" aria-hidden="true"><span>▣</span><span class="empty-plus">+</span></div>
            <h2>Let's connect your first computer.</h2>
            <p>Add your own desktop, laptop or server. You decide what your AI assistant can do.</p>
            <button class="btn btn-primary" type="button" onclick="switchTab('add-device')">Connect a device <span aria-hidden="true">→</span></button>
            <div class="empty-next-step">Next: <strong>Connect an AI app</strong> after the device is online.</div>
          </div>\`;
        }
        return \`<section class="device-list-card card" aria-label="Your enrolled devices">
          <div class="device-list-heading"><div><h2>Your devices</h2><p>\${devicesList.length} enrolled · \${devicesList.filter(d => d.isLiveConnected).length} online</p></div><div class="device-list-tools"><button class="btn btn-outline btn-sm" type="button" onclick="switchTab('audit')">Open activity</button> <button class="btn btn-outline btn-sm" type="button" onclick="loadDevices()">Refresh</button></div></div>
          <div class="device-list-body">
          \${devicesList.map(dev => \`
            <article class="device-entry">
              <div class="device-row">
                <div class="device-info">
                  <div class="device-icon" aria-hidden="true">\${dev.host_metadata?.platform === 'win32' ? '▣' : dev.host_metadata?.platform === 'darwin' ? '⌘' : '⌁'}</div>
                  <div class="device-ident"><div class="device-name">\${escapeHtml(dev.alias)}</div>
                  <div class="device-meta">\${escapeHtml(dev.host_metadata?.os || dev.host_metadata?.platform || 'Computer')} · \${escapeHtml(dev.host_metadata?.hostname || 'Device')} · \${escapeHtml(dev.profile)}</div><div class="device-meta">Agent: \${escapeHtml(dev.agent_version && dev.agent_version !== 'unknown' ? dev.agent_version : 'Not reported')} · Server: \${escapeHtml(dev.server_version || 'Not reported')} \${dev.agent_update_status === 'older_than_server' ? '· Older than server — update recommended' : dev.agent_update_status === 'unknown' ? '· Confirm local version' : ''} <a href="https://github.com/oaslananka/ssh-mcp-pro/releases/latest" target="_blank" rel="noopener noreferrer">Check releases</a></div><div class="device-meta">AI access: \${Array.isArray(dev.aiConnections) && dev.aiConnections.length ? escapeHtml(dev.aiConnections.map(c => c.name).join(', ')) : 'No explicitly shared AI connections'}\${strictVisibilityEnabled ? '' : ' · Legacy connections may still have access'}</div></div>
                </div>
                <div class="device-row-status"><span class="status-pill \${dev.isLiveConnected ? 'online' : 'offline'}"><span aria-hidden="true"></span>\${dev.isLiveConnected ? 'Online' : dev.status === 'revoked' ? 'Access revoked' : 'Offline'}</span>
                  <details class="device-controls">
                    <summary>Manage <span aria-hidden="true">⌄</span></summary>
                    <div class="device-control-panel">
                      <h3>Advanced device controls</h3>
                      <p>Permission changes affect what this device can do. You can revoke or remove it at any time.</p>
                      <p class="device-technical-meta">Host: \${escapeHtml(dev.host_metadata?.hostname || 'Not reported')} · OS: \${escapeHtml(dev.host_metadata?.os || 'Not reported')} · Architecture: \${escapeHtml(dev.host_metadata?.arch || 'Not reported')} · Platform: \${escapeHtml(dev.host_metadata?.platform || 'Not reported')} · Policy v\${escapeHtml(dev.policy_version ?? '—')}</p>
                      <label for="profile-\${escapeHtml(dev.id)}">Permission profile</label>
                      <select id="profile-\${escapeHtml(dev.id)}" aria-label="Policy for \${escapeHtml(dev.alias)}" class="btn btn-outline btn-sm" onchange="changePolicy('\${dev.id}', this.value)" \${dev.status === 'revoked' ? 'disabled' : ''}>
                        <option value="read-only" \${dev.profile === 'read-only' ? 'selected' : ''}>Read only</option>
                        <option value="operations" \${dev.profile === 'operations' ? 'selected' : ''}>Operations</option>
                        <option value="full-admin" \${dev.profile === 'full-admin' ? 'selected' : ''}>Full admin</option>
                      </select>
                      <div class="device-control-actions"><button class="btn btn-outline btn-sm" type="button" onclick="revokeDevice('\${dev.id}')" \${dev.status === 'revoked' ? 'disabled' : ''}>\${dev.status === 'revoked' ? 'Revoked' : 'Revoke access'}</button>
                      <button class="btn btn-danger btn-sm" type="button" onclick="removeDevice('\${dev.id}')">Remove device</button></div>
                    </div>
                  </details>
                </div>
              </div>
              \${!dev.isLiveConnected && dev.status !== 'revoked' ? '<div class="device-offline-tip">Agent offline — start ssh-mcp-pro Agent on this computer to reconnect. <a href="https://github.com/oaslananka/ssh-mcp-pro/blob/main/docs/adding-a-device.md" target="_blank" rel="noopener noreferrer">Connection help</a></div>' : ''}
            </article>
          \`).join('')}
          </div>
        </section>
        \`;
      }

      if (activeTab === 'add-device') {
        return \`
          <div class="device-wizard">
            <div class="wizard-stepper">
              <div class="stepper-item active">
                <div class="stepper-dot"></div>
                <span>Choose method</span>
              </div>
              <div class="stepper-line"></div>
              <div class="stepper-item">
                <div class="stepper-dot"></div>
                <span>Start on device</span>
              </div>
              <div class="stepper-line"></div>
              <div class="stepper-item">
                <div class="stepper-dot"></div>
                <span>Verify</span>
              </div>
            </div>

            <h2 class="wizard-title">Connect this device</h2>
            <p class="wizard-subtitle">Desktop Commander Remote runs on this device so your AI chat can work with your files. Choose how to connect.</p>

            <div class="platform-segmented" role="tablist">
              <button type="button" class="platform-tab-btn \${selectedInstallOs === 'windows' ? 'active' : ''}" data-install-os="windows" onclick="chooseInstallOS('windows')">Windows</button>
              <button type="button" class="platform-tab-btn \${selectedInstallOs === 'macos' ? 'active' : ''}" data-install-os="macos" onclick="chooseInstallOS('macos')">macOS</button>
              <button type="button" class="platform-tab-btn \${selectedInstallOs === 'linux' ? 'active' : ''}" data-install-os="linux" onclick="chooseInstallOS('linux')">Linux</button>
            </div>

            <p class="wizard-note">Choose one method. You can change it anytime.</p>

            <!-- Windows methods -->
            <div data-os-section="windows" \${selectedInstallOs === 'windows' ? '' : 'hidden'}>
              <div class="wizard-method-card">
                <div class="wizard-method-header">
                  <div class="wizard-method-title">Download and run <span class="badge-recommended">Recommended</span></div>
                </div>
                <p class="wizard-method-desc">Easiest option. No commands to type.</p>
              </div>

              <div class="wizard-method-card">
                <div class="wizard-method-header">
                  <div class="wizard-method-title">PowerShell setup script</div>
                </div>
                <p class="wizard-method-desc">One command. Installs Node.js if needed.</p>
                <div class="wizard-codebox">
                  <code id="cmdWinOneLiner">irm -ErrorAction Stop \${PUBLIC_URL.replace(/\\/+$/, '')}/install/remote-windows.ps1 | iex</code>
                  <button type="button" class="wizard-copy-btn" onclick="copySnippet('cmdWinOneLiner')">Copy</button>
                </div>
                <p style="font-size:11px; color:#647083; margin-top:8px;">After copying, we'll show you how to open PowerShell and run the command.</p>
              </div>

              <div class="wizard-method-card">
                <div class="wizard-method-header">
                  <div class="wizard-method-title">npx (advanced)</div>
                </div>
                <p class="wizard-method-desc">Requires Node.js 22.12+ already installed.</p>
                <div class="wizard-codebox">
                  <code id="cmdWinNpx">npx.cmd ssh-mcp-pro@latest remote</code>
                  <button type="button" class="wizard-copy-btn" onclick="copySnippet('cmdWinNpx')">Copy</button>
                </div>
                <p style="font-size:11px; color:#647083; margin-top:8px;">After copying, we'll show you how to open PowerShell and run the command.</p>
              </div>
            </div>

            <!-- macOS methods -->
            <div data-os-section="macos" \${selectedInstallOs === 'macos' ? '' : 'hidden'}>
              <div class="wizard-method-card" style="cursor:default;">
                <div class="wizard-method-header">
                  <div class="wizard-method-title">Quick setup <span class="badge-recommended">Recommended</span></div>
                </div>
                <p class="wizard-method-desc">Starts ssh-mcp-pro. If Node.js can't be found, you'll be asked before installing it.</p>
                <div class="wizard-codebox">
                  <code id="cmdMacOneLiner">$ curl -fsSL \${PUBLIC_URL.replace(/\\/+$/, '')}/install/remote-macos.sh | sh</code>
                </div>
                <button type="button" class="wizard-btn-primary" onclick="copySnippet('cmdMacOneLiner')">Copy setup command</button>
                <p style="text-align:center; font-size:11px; color:#647083; margin-top:10px;"><a href="https://github.com/oaslananka/ssh-mcp-pro" target="_blank" rel="noopener noreferrer" style="color:#647083;">All these scripts are open source. You can view them on GitHub ↗</a></p>
              </div>

              <div class="wizard-method-card">
                <div class="wizard-method-header">
                  <div class="wizard-method-title">Other ways to connect</div>
                </div>
                <p class="wizard-method-desc">Use your own Node.js installation (Requires Node.js 22.12 or newer)</p>
                <div class="wizard-codebox">
                  <code id="cmdMacNpx">npx ssh-mcp-pro@latest remote</code>
                </div>
                <button type="button" class="btn btn-outline" style="width:100%; margin-top:8px;" onclick="copySnippet('cmdMacNpx')">Copy npx command</button>
              </div>
            </div>

            <!-- Linux methods -->
            <div data-os-section="linux" \${selectedInstallOs === 'linux' ? '' : 'hidden'}>
              <div class="wizard-method-card" style="cursor:default;">
                <div class="wizard-method-header">
                  <div class="wizard-method-title">Quick setup <span class="badge-recommended">Recommended</span></div>
                </div>
                <p class="wizard-method-desc">Starts ssh-mcp-pro. If Node.js can't be found, you'll be asked before installing it.</p>
                <div class="wizard-codebox">
                  <code id="cmdLinuxOneLiner">$ curl -fsSL \${PUBLIC_URL.replace(/\\/+$/, '')}/install/remote-linux.sh | sh</code>
                </div>
                <button type="button" class="wizard-btn-primary" onclick="copySnippet('cmdLinuxOneLiner')">Copy setup command</button>
                <p style="text-align:center; font-size:11px; color:#647083; margin-top:10px;"><a href="https://github.com/oaslananka/ssh-mcp-pro" target="_blank" rel="noopener noreferrer" style="color:#647083;">All these scripts are open source. You can view them on GitHub ↗</a></p>
              </div>

              <div class="wizard-method-card">
                <div class="wizard-method-header">
                  <div class="wizard-method-title">Other ways to connect</div>
                </div>
                <p class="wizard-method-desc">Use your own Node.js installation (Requires Node.js 22.12 or newer)</p>
                <div class="wizard-codebox">
                  <code id="cmdLinuxNpx">npx ssh-mcp-pro@latest remote</code>
                </div>
                <button type="button" class="btn btn-outline" style="width:100%; margin-top:8px;" onclick="copySnippet('cmdLinuxNpx')">Copy npx command</button>
              </div>
            </div>

            <div class="wizard-footer-link">
              Want to use a server we host instead of your own computer? <a href="https://github.com/oaslananka/ssh-mcp-pro/issues" target="_blank" rel="noopener noreferrer">Tell us ↗</a>
            </div>
          </div>

          <div class="card" style="max-width:620px; margin:0 auto 30px;">
            <h2 style="margin-bottom:12px; font-size:17px;">Custom enrollment & approvals</h2>
            <p style="color:var(--text-muted); font-size:13px; margin-bottom:20px;">\${localBrowserLink ? 'Approve the local agent waiting in your terminal. The one-time credential stays inside your browser and device; do not copy it into chat.' : 'Optionally generate custom named tokens or approve waiting terminals.'}</p>
            \${localBrowserLink ? '<p style="color:var(--text-muted); font-size:13px; margin-bottom:16px;">Chrome may ask to access other apps and services on this device. Bring this browser window to the front and choose Allow for this trusted site. If the prompt is hidden, check Chrome’s address bar; the connection check stops after one minute so you can retry.</p>' : ''}
            <div class="os-chooser" aria-label="Choose device operating system" role="group">
              <span>Which operating system?</span>
              <div class="os-chooser-options">
                <button type="button" class="os-choice active" data-install-os="windows" aria-pressed="true" onclick="chooseInstallOS('windows')">Windows</button>
                <button type="button" class="os-choice" data-install-os="linux" aria-pressed="false" onclick="chooseInstallOS('linux')">Linux / WSL</button>
                <button type="button" class="os-choice" data-install-os="macos" aria-pressed="false" onclick="chooseInstallOS('macos')">macOS</button>
              </div>
            </div>
            <div data-os-section="linux" style="display:\${localBrowserLink ? 'none' : 'block'}; margin-bottom:20px; padding:14px; border:1px solid var(--card-border); border-radius:8px;">
              <h3 style="margin-bottom:8px; font-size:14px;">Linux / WSL: Set up with your browser</h3>
              <p style="color:var(--text-muted); font-size:13px; margin-bottom:12px;">Copy this command to the device you want to enroll. Open the URL printed in its terminal in a browser on that same device, sign in and approve. No token copying or sudo required.</p>
              <div class="code-box">
                <button type="button" class="copy-btn" aria-live="polite" aria-label="Copy token-free Linux browser setup" onclick="copySnippet('cmdBrowser')">Copy</button>
                <span id="cmdBrowser">\${escapeHtml(BROWSER_LINUX_COMMAND)}</span>
              </div>
            </div>
            <div style="display:flex; gap:16px; margin-bottom:24px; flex-wrap:wrap;">
              <div style="flex:1; min-width:240px;">
                <label for="enrollAlias" style="display:block; font-size:13px; font-weight:600; margin-bottom:6px;">Device name</label>
                <input id="enrollAlias" type="text" placeholder="e.g. production-bastion, home-server" style="width:100%; padding:10px; border-radius:6px; background:#090d13; border:1px solid var(--card-border); color:#fff; font-size:14px;">
              </div>
              <div style="flex:1; min-width:240px;">
                <label for="enrollProfile" style="display:block; font-size:13px; font-weight:600; margin-bottom:6px;">Access level</label>
                <select id="enrollProfile" style="width:100%; padding:10px; border-radius:6px; background:#090d13; border:1px solid var(--card-border); color:#fff; font-size:14px;">
                  <option value="read-only" selected>Read-Only (Status, Logs, Read Files)</option>
                  <option value="operations">Operations (Restart Services, Docker, Safe Shell)</option>
                  <option value="full-admin">Full Admin (Root sudo, File Write, Service Admin)</option>
                </select>
              </div>
            </div>
            <button id="generateEnrollmentButton" type="button" class="btn btn-primary" onclick="generateEnrollment()">\${localBrowserLink ? 'Approve This Device' : 'Generate setup commands'}</button>
            <p id="enrollError" role="alert" hidden style="color:var(--danger, #f85149); margin-top:12px;"></p>

            <div id="enrollOutput" style="margin-top:24px; display:none;">
              <p id="enrollStatus" role="status" aria-live="polite" style="margin-bottom:12px; color:var(--text-muted);"></p>
              <button id="enrollViewDevice" type="button" class="btn btn-primary" hidden style="display:none; margin-bottom:16px;" onclick="switchTab('devices')">View connected device</button>
              <div id="manualInstallCommands" style="display:\${localBrowserLink ? 'none' : 'block'};">
              <h3 style="margin-bottom:12px; color:#fff;">Step 2 — Run the setup command for your system:</h3>

              <div data-os-section="linux" style="margin-bottom:16px;">
                <div style="font-weight:600; font-size:13px; color:var(--blue); margin-bottom:4px;">🐧 Linux (systemd)</div>
                <div class="code-box">
                  <button type="button" class="copy-btn" aria-live="polite" aria-label="Copy Linux install command" onclick="copySnippet('cmdLinux')">Copy</button>
                  <span id="cmdLinux"></span>
                </div>
              </div>

              <div data-os-section="windows" style="margin-bottom:16px;">
                <div style="font-weight:600; font-size:13px; color:var(--blue); margin-bottom:4px;">🪟 Windows (PowerShell)</div>
                <div class="code-box">
                  <button type="button" class="copy-btn" aria-live="polite" aria-label="Copy Windows install command" onclick="copySnippet('cmdWindows')">Copy</button>
                  <span id="cmdWindows"></span>
                </div>
              </div>

              <div data-os-section="macos">
                <div style="font-weight:600; font-size:13px; color:var(--blue); margin-bottom:4px;">📦 Manual Node CLI (foreground)</div>
                <p style="font-size:12px; color:var(--text-muted); margin-bottom:6px;">Advanced Linux/macOS fallback: the terminal must stay open. Use an OS service installer for automatic restart.</p>
                <div class="code-box">
                  <button type="button" class="copy-btn" aria-live="polite" aria-label="Copy Node install command" onclick="copySnippet('cmdNpm')">Copy</button>
                  <span id="cmdNpm"></span>
                </div>
              </div>
              </div>
            </div>
          </div>
        \`;
      }

      if (activeTab === 'clients') {
        return \`
          <section class="integration-feature">
            <p class="eyebrow">ONE SECURE CONNECTION</p>
            <h2>Connect your favorite AI assistant</h2>
            <p>Copy this MCP server URL into the app you use, then sign in with the same account as your devices.</p>
            <div class="code-box connection-url"><button type="button" class="copy-btn" aria-live="polite" aria-label="Copy MCP server URL" onclick="copySnippet('sharedMcpUrl')">Copy URL</button><span id="sharedMcpUrl">\${MCP_URL}</span></div>
          </section>
          <div class="platform-grid" aria-label="AI app connection instructions">
            <article class="platform-card"><span class="platform-symbol chatgpt" aria-hidden="true">✳</span><h3>ChatGPT</h3><p>In a supported workspace, open Plugins and add a custom MCP server. Paste the URL above and authorize access.</p><small>ChatGPT Work · OAuth connection</small></article>
            <article class="platform-card"><span class="platform-symbol claude" aria-hidden="true">✴</span><h3>Claude</h3><p>Open Customize → Connectors → Add custom connector. Paste the URL and sign in.</p><small>Claude Web · Custom connector</small></article>
            <article class="platform-card"><span class="platform-symbol gemini" aria-hidden="true">✦</span><h3>Gemini</h3><p>Eligible Developer Mode users can add the MCP server. Google registration and review are separate.</p><small>Gemini Web · Developer Mode</small></article>
          </div>
          <div class="integration-next"><span class="live-indicator" aria-hidden="true"></span><p>Choose an online device in your AI chat after connecting. Available tools depend on your account and its permissions.</p></div>
          <details class="advanced-integrations">
            <summary>Advanced setup and configuration examples <span aria-hidden="true">⌄</span></summary>
            <div class="grid-2">
            <div class="card">
              <div style="display:flex; align-items:center; gap:8px; margin-bottom:8px;">
                <span style="font-size:24px;">🤖</span>
                <h3>Claude Desktop & Claude Code</h3>
              </div>
              <p style="font-size:13px; color:var(--text-muted); margin-bottom:12px;">For remote access in Claude or Claude Desktop: <strong>Customize &gt; Connectors &gt; Add custom connector</strong>, enter this URL, then sign in. Local Desktop servers still use <code>claude_desktop_config.json</code>.</p>
              <div style="font-size:12px; font-weight:700; color:var(--blue);">Claude remote custom connector URL:</div>
              <div class="code-box"><button type="button" class="copy-btn" aria-live="polite" aria-label="Copy Claude remote MCP URL" onclick="copySnippet('cfgClaudeRemote')">Copy</button><span id="cfgClaudeRemote">\${MCP_URL}</span></div>
              <div style="font-size:12px; font-weight:700; color:var(--blue); margin-top:12px;">Claude Code remote (run in a terminal):</div>
              <div class="code-box"><button type="button" class="copy-btn" aria-live="polite" aria-label="Copy Claude Code command" onclick="copySnippet('cfgClaudeCode')">Copy</button><span id="cfgClaudeCode">claude mcp add --transport http ssh-mcp-pro \${MCP_URL}</span></div>
              <div style="font-size:12px; font-weight:700; color:#7ee787; margin-top:12px;">Claude Desktop local stdio:</div>
              <div class="code-box"><button type="button" class="copy-btn" aria-live="polite" aria-label="Copy Claude Desktop config" onclick="copySnippet('cfgClaudeLocal')">Copy</button><span id="cfgClaudeLocal">{\\n  "mcpServers": {\\n    "ssh-mcp-pro": {\\n      "command": "ssh-mcp-pro",\\n      "args": []\\n    }\\n  }\\n}</span></div>
            </div>

            <div class="card">
              <div style="display:flex; align-items:center; gap:8px; margin-bottom:8px;">
                <span style="font-size:24px;">💬</span>
                <h3>ChatGPT MCP Plugin</h3>
              </div>
              <p style="font-size:13px; color:var(--text-muted); margin-bottom:12px;">In supported ChatGPT workspaces, open <strong>Plugins &gt; Add custom MCP server</strong>, paste the URL below and configure OAuth. Custom GPT Actions are a separate OpenAPI-based feature.</p>
              <div class="code-box"><button type="button" class="copy-btn" aria-live="polite" aria-label="Copy ChatGPT MCP URL" onclick="copySnippet('cfgChatGptMcp')">Copy</button><span id="cfgChatGptMcp">\${MCP_URL}</span></div>
            </div>

            <div class="card">
              <div style="display:flex; align-items:center; gap:8px; margin-bottom:8px;">
                <span style="font-size:24px;">✨</span>
                <h3>Gemini API (Interactions)</h3>
              </div>
              <p style="font-size:13px; color:var(--text-muted); margin-bottom:12px;">Use this Remote MCP tool definition with the Gemini API Interactions endpoint. Configure a valid OAuth bearer credential separately (for example via managed agent credentials); the URL alone does not authenticate. This is not a Gemini web-extension manifest. <a href="https://ai.google.dev/gemini-api/docs/function-calling" target="_blank" rel="noopener noreferrer">Gemini Remote MCP docs</a>.</p>
              <div class="code-box"><button type="button" class="copy-btn" aria-live="polite" aria-label="Copy Gemini MCP config" onclick="copySnippet('cfgGemini')">Copy</button><span id="cfgGemini">{\\n  "type": "mcp_server",\\n  "name": "ssh_mcp_pro",\\n  "url": "\${MCP_URL}"\\n}</span></div>
            </div>

            <div class="card">
              <div style="display:flex; align-items:center; gap:8px; margin-bottom:8px;">
                <span style="font-size:24px;">💻</span>
                <h3>VS Code / Cursor / Windsurf</h3>
              </div>
              <p style="font-size:13px; color:var(--text-muted); margin-bottom:12px;">Copy the configuration for your chosen client. VS Code/Copilot portable files use <code>mcpServers</code>; the VS Code workspace format uses <code>servers</code>. Sign in through your client&#39;s OAuth flow.</p>
              <div style="font-size:12px; font-weight:700; color:var(--blue); margin-top:12px;">Copilot portable — <code>.mcp.json</code></div>
              <div class="code-box"><button type="button" class="copy-btn" aria-live="polite" aria-label="Copy VS Code portable config" onclick="copySnippet('cfgVsCodePortable')">Copy</button><span id="cfgVsCodePortable">{\\n  "mcpServers": {\\n    "ssh-mcp-pro": {\\n      "type": "http",\\n      "url": "\${MCP_URL}"\\n    }\\n  }\\n}</span></div>
              <div style="font-size:12px; font-weight:700; color:var(--blue); margin-top:12px;">VS Code workspace (compatible) — <code>.vscode/mcp.json</code></div>
              <div class="code-box"><button type="button" class="copy-btn" aria-live="polite" aria-label="Copy VS Code workspace config" onclick="copySnippet('cfgVsCode')">Copy</button><span id="cfgVsCode">{\\n  "servers": {\\n    "ssh-mcp-pro": {\\n      "type": "http",\\n      "url": "\${MCP_URL}"\\n    }\\n  }\\n}</span></div>
              <div style="font-size:12px; font-weight:700; color:var(--blue); margin-top:12px;">Cursor — <code>.cursor/mcp.json</code></div>
              <div class="code-box"><button type="button" class="copy-btn" aria-live="polite" aria-label="Copy Cursor MCP config" onclick="copySnippet('cfgCursor')">Copy</button><span id="cfgCursor">{\\n  "mcpServers": {\\n    "ssh-mcp-pro": {\\n      "url": "\${MCP_URL}"\\n    }\\n  }\\n}</span></div>
              <div style="font-size:12px; font-weight:700; color:var(--blue); margin-top:12px;">Windsurf — <code>mcp_config.json</code></div>
              <div class="code-box"><button type="button" class="copy-btn" aria-live="polite" aria-label="Copy Windsurf MCP config" onclick="copySnippet('cfgWindsurf')">Copy</button><span id="cfgWindsurf">{\\n  "mcpServers": {\\n    "ssh-mcp-pro": {\\n      "serverUrl": "\${MCP_URL}"\\n    }\\n  }\\n}</span></div>
            </div>
          </div>
          </details>
        \`;
      }

      if (activeTab === 'ai-clients') return renderAiClientsPanel();

      if (activeTab === 'audit') {
        if (!auditLoaded) return '<div class="card device-loading" role="status">Loading activity…</div>';
        if (auditError) return '<div class="card feedback-error" role="alert"><h2>Could not load activity</h2><p>Recent events are unavailable. Check your connection and try again.</p><button type="button" class="btn btn-primary" onclick="loadAudit()">Try again</button></div>';
        if (auditList.length === 0) {
          return '<div class="card empty-box">No audit events recorded yet.</div>';
        }
        return \`
          <div class="card" style="padding:0; overflow:hidden; border:1px solid #1e2430; border-radius:14px;">
            <table style="width:100%; border-collapse:collapse; font-size:13px; text-align:left;">
              <thead style="background:#151922; border-bottom:1px solid #1e2430;">
                <tr>
                  <th style="padding:14px 18px; color:#8e9bb0; font-size:11px; text-transform:uppercase; letter-spacing:.05em; font-weight:600;">Timestamp</th>
                  <th style="padding:14px 18px; color:#8e9bb0; font-size:11px; text-transform:uppercase; letter-spacing:.05em; font-weight:600;">Event</th>
                  <th style="padding:14px 18px; color:#8e9bb0; font-size:11px; text-transform:uppercase; letter-spacing:.05em; font-weight:600;">Severity</th>
                  <th style="padding:14px 18px; color:#8e9bb0; font-size:11px; text-transform:uppercase; letter-spacing:.05em; font-weight:600;">Target</th>
                </tr>
              </thead>
              <tbody>
                \${auditList.map(e => \`
                  <tr style="border-bottom:1px solid #1a202c; transition:background .15s ease;">
                    <td style="padding:14px 18px; font-family:var(--font-mono); color:var(--text-muted); font-size:12px;">\${new Date(e.createdAt).toLocaleTimeString()}</td>
                    <td style="padding:14px 18px; font-weight:600; color:#ffffff;">\${escapeHtml(e.eventType)}</td>
                    <td style="padding:14px 18px;"><span class="badge \${e.severity === 'info' ? 'badge-blue' : (e.severity === 'warn' ? 'badge-green' : 'badge-gray')}">\${e.severity}</span></td>
                    <td style="padding:14px 18px; font-family:var(--font-mono); color:var(--text-muted); font-size:12px;">\${escapeHtml(e.agentAlias || e.agentId || e.actionId || '-')}</td>
                  </tr>
                \`).join('')}
              </tbody>
            </table>
          </div>
        \`;
      }
    }

`;
