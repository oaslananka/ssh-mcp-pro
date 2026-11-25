export const DASHBOARD_AI_CLIENT_SCRIPT = `    function renderAiConnectionCards() {
      if (!aiConnectionsList.length) {
        return '<section class="card ai-clients-empty"><h3>No device-scoped connections yet</h3>' +
          '<p>Authorize an AI app first. Then select which devices it may see. Older connections can reconnect to become individually managed.</p></section>';
      }
      return '<section class="ai-connection-grid" aria-label="AI device access">' +
        aiConnectionsList.map((connection, i) => {
          const active = connection.status === 'active';
          const selected = new Set(connection.deviceIds || []);
          const choices = devicesError ? '<p role="alert">Devices unavailable. Refresh to retry.</p>' :
            devicesList.filter(device => device.status !== 'revoked').map(device => {
              const choiceId = 'ai-connection-' + i + '-' + device.id;
              return '<label class="ai-device-choice" for="' + escapeHtml(choiceId) + '">' +
                '<input id="' + escapeHtml(choiceId) + '" type="checkbox" data-ai-index="' + i +
                '" value="' + escapeHtml(device.id) + '" ' +
                (selected.has(device.id) ? 'checked ' : '') + (!active ? 'disabled ' : '') + '>' +
                '<span><strong>' + escapeHtml(device.alias) + '</strong><small>' +
                (device.isLiveConnected ? 'Online' : 'Offline') + ' · ' +
                escapeHtml(device.profile || 'Device') + '</small></span></label>';
            }).join('');
          return '<article class="card ai-connection-card"><div class="ai-connection-top"><div><h3>' +
            escapeHtml(connection.clientName) + '</h3><small>' +
            escapeHtml((connection.redirectHosts || []).join(', ') || 'Unverified client') +
            '</small></div><span class="status-pill ' + (active ? 'online' : 'offline') + '">' +
            (active ? 'Connected' : 'Disconnected') + '</span></div>' +
            '<p class="ai-connection-id">Connection ' + escapeHtml(connection.id.slice(-8)) +
            ' · ' + selected.size + ' device(s) allowed</p>' +
            '<fieldset class="ai-device-fieldset" ' + (active ? '' : 'disabled ') +
            '><legend>Devices this AI can access</legend>' +
            (choices || '<p>No devices available. Connect a device first.</p>') + '</fieldset>' +
            (active ? '<div class="ai-client-actions"><button class="btn btn-primary btn-sm" type="button" ' +
              'onclick="saveAiConnectionDevices(' + i + ')"' + (devicesError ? ' disabled' : '') +
              '>Save device access</button><button class="btn btn-outline btn-sm" type="button" ' +
              'onclick="disconnectAiConnection(' + i + ')">Disconnect this AI</button></div>' : '') +
            '</article>';
        }).join('') + '</section>';
    }

    async function saveAiConnectionDevices(i) {
      const connection = aiConnectionsList[i];
      if (!connection || connection.status !== 'active' || devicesError) return;
      const deviceIds = [...document.querySelectorAll('[data-ai-index="' + i + '"]:checked')]
        .map(input => input.value);
      if (!strictVisibilityEnabled &&
          !window.confirm('Enabling device controls requires older unbound AI sessions to reconnect. Continue?')) return;
      try {
        const response = await fetch('/api/dashboard/ai-connections/' +
          encodeURIComponent(connection.id) + '/devices', {
          method: 'PUT', headers: {
            'Content-Type': 'application/json', 'X-SSH-MCP-Dashboard': '1'
          }, body: JSON.stringify({ deviceIds })
        });
        if (!response.ok) throw new Error('Update not confirmed');
        aiClientNotice = 'Device access saved. New AI requests follow these permissions immediately.';
        await loadAiClients();
      } catch {
        aiClientNotice = 'Could not confirm device access changes. Refresh and retry.';
        if (activeTab === 'ai-clients') document.getElementById('tabContent').innerHTML = renderAiClientsPanel();
      }
    }

    async function disconnectAiConnection(i) {
      const connection = aiConnectionsList[i];
      if (!connection || connection.status !== 'active') return;
      if (!window.confirm('Disconnect this AI? Its new requests will be denied; devices stay connected.')) return;
      try {
        const response = await fetch('/api/dashboard/ai-connections/' +
          encodeURIComponent(connection.id) + '/disconnect', {
          method: 'POST', headers: { 'X-SSH-MCP-Dashboard': '1' }
        });
        if (!response.ok) throw new Error('Disconnection not confirmed');
        aiClientNotice = 'AI connection disconnected. Your devices are unchanged.';
        await loadAiClients();
      } catch {
        aiClientNotice = 'Could not confirm disconnection. Refresh and retry.';
        if (activeTab === 'ai-clients') document.getElementById('tabContent').innerHTML = renderAiClientsPanel();
      }
    }

    function renderAiClientsPanel() {
      if (!aiClientsLoaded) return '<div class="card device-loading" role="status">Loading AI clients…</div>';
      if (aiClientsError) return '<div class="card feedback-error" role="alert"><h2>AI clients unavailable</h2><p>Your permissions have not changed.</p><button class="btn btn-primary" onclick="loadAiClients()">Retry</button></div>';
      const heading = '<div class="ai-clients-intro"><div><span class="eyebrow">ACCOUNT ACCESS</span><h2>Authorized AI clients</h2><p>Assistants with renewable OAuth grants for this ' + escapeHtml(currentUser.provider === 'google' ? 'Google' : 'GitHub') + ' account.</p></div><button class="btn btn-outline btn-sm" onclick="loadAiClients()">Refresh</button></div>';
      const notice = aiClientNotice ? '<p class="ai-client-notice" role="status">' + escapeHtml(aiClientNotice) + '</p>' : '';
      const deviceControls = renderAiConnectionCards();
      if (!aiClientsList.length) return heading + notice + deviceControls;
      const rows = aiClientsList.map((c, i) => {
        const active = Number(c.activeGrants) > 0;
        const scopes = Array.isArray(c.scopes) ? c.scopes : [];
        const permissions = !active ? 'Disconnected' : scopes.some(s => /:write|:manage|:exec|admin/.test(s)) ? 'Elevated scopes' : 'Read scopes';
        const when = c.lastTokenAt ? new Date(c.lastTokenAt).toLocaleString() : 'Not recorded';
        const created = c.registeredAt ? new Date(c.registeredAt).toLocaleString() : 'Not recorded';
        const hosts = Array.isArray(c.redirectHosts) ? c.redirectHosts.join(', ') : '';
        const detail = 'ai-client-detail-' + i;
        return '<tr><td data-label="Client"><strong>' + escapeHtml(c.clientName) + '</strong><small class="ai-client-id">' + escapeHtml(c.clientId) + '</small></td>' +
          '<td data-label="Redirect host">' + escapeHtml(hosts || 'Unknown') + '</td><td data-label="Created">' + escapeHtml(created) + '</td><td data-label="Last renewal">' + escapeHtml(when) + '</td>' +
          '<td data-label="Active grants"><span class="ai-client-grant ' + (active ? 'is-active' : '') + '">' + Number(c.activeGrants || 0) + '</span></td>' +
          '<td data-label="Permissions">' + escapeHtml(permissions) + '</td><td data-label="Actions"><div class="ai-client-actions">' +
          '<button type="button" class="btn btn-outline btn-sm" aria-controls="' + detail + '" aria-expanded="false" onclick="toggleAiClientDetails(' + i + ', this)">Manage access</button>' +
          '<button type="button" class="btn btn-danger btn-sm" ' + (active ? '' : 'disabled ') + 'onclick="revokeAiClient(' + i + ')">Revoke</button></div></td></tr>' +
          '<tr class="ai-client-details-row" id="' + detail + '" hidden><td colspan="7"><div class="ai-client-details"><strong>Granted OAuth scopes</strong><p>' +
          escapeHtml(scopes.length ? scopes.join(' · ') : 'No active renewable scopes') + '</p><small>Registered ' + escapeHtml(created) + '. To change OAuth scopes, revoke the grant and reconnect. Device policy is enforced separately.</small></div></td></tr>';
      }).join('');
      return heading + notice + deviceControls + '<h3 class="ai-client-section-heading">OAuth client grants</h3>' +
        '<div class="ai-clients-table-wrap"><table class="ai-clients-table"><thead><tr><th>Client</th><th>Redirect host</th><th>Created</th><th>Last renewal</th><th>Active grants</th><th>Permissions</th><th>Actions</th></tr></thead><tbody>' +
        rows + '</tbody></table></div><p class="ai-client-footnote">Shows renewable OAuth grants for this account, not all registered clients. Revocation disables future refreshes, without changing other users or shared registrations. Previously issued access tokens may remain valid until expiry before device restrictions are enabled. Device-scoped connections are checked on each request. Older unbound connections need to reconnect after device controls are enabled. Local stdio MCP has separate permissions.</p>';
    }

    function toggleAiClientDetails(i, button) {
      const details = document.getElementById('ai-client-detail-' + i);
      if (!details) return;
      details.hidden = !details.hidden;
      button.setAttribute('aria-expanded', String(!details.hidden));
    }

    async function loadAiClients() {
      try {
        const response = await fetch('/api/dashboard/ai-clients', { cache: 'no-store' });
        if (!response.ok) throw new Error('AI clients API unavailable');
        const data = await response.json();
        aiClientsList = Array.isArray(data.clients) ? data.clients : [];
        aiConnectionsList = Array.isArray(data.connections) ? data.connections : [];
        strictVisibilityEnabled = data.strictVisibility === true;
        await loadDevices();
        aiClientsError = '';
      } catch (error) {
        aiClientsError = 'unavailable';
        console.error('AI clients request failed', error);
      } finally {
        aiClientsLoaded = true;
        const target = document.getElementById('tabContent');
        if (activeTab === 'ai-clients' && target) target.innerHTML = renderAiClientsPanel();
      }
    }

    async function revokeAiClient(i) {
      const client = aiClientsList[i];
      if (!client || Number(client.activeGrants) < 1) return;
      if (!window.confirm('Revoke ' + client.clientName + ' refresh access for your account? Existing access tokens can remain valid until they expire.')) return;
      try {
        const response = await fetch('/api/dashboard/ai-clients/' + encodeURIComponent(client.clientId) + '/revoke', {
          method: 'POST', headers: { 'X-SSH-MCP-Dashboard': '1' },
        });
        if (!response.ok) throw new Error('Could not revoke client');
        aiClientNotice = 'Renewable access revoked for ' + client.clientName + '.';
        await loadAiClients();
      } catch (error) {
        aiClientNotice = 'Revocation not confirmed. Retry if needed.';
        const target = document.getElementById('tabContent');
        if (activeTab === 'ai-clients' && target) target.innerHTML = renderAiClientsPanel();
      }
    }

`;
