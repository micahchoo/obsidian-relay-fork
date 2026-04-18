/// <reference path="../pb_data/types.d.ts" />

// POST /api/collections/relays/self-host
// Called by RelayManager.createSelfHostedRelay when user registers a self-hosted relay server.
// Input:  { url?: string, provider?: string, organization?: string }
// Output: relay record
routerAdd("POST", "/api/collections/relays/self-host", (c) => {
    const info = $apis.requestInfo(c)
    if (!info.authRecord) {
        return c.json(401, { error: "Unauthorized" })
    }

    const body        = info.data
    const serverUrl   = body.url
    const providerId  = body.provider
    const userId      = info.authRecord.id

    let provider
    if (providerId) {
        // Use existing provider
        try {
            provider = $app.dao().findRecordById("providers", providerId)
        } catch (_) {
            return c.json(404, { error: "Provider not found" })
        }
    } else if (serverUrl) {
        // Ping the server to verify it's alive
        // Try the user-provided URL first, then fall back to Docker-internal hostname
        const trimmedUrl = serverUrl.replace(/\/$/, "")
        let reachable = false
        const urls = [trimmedUrl]
        // In Docker, localhost URLs won't work — try the compose service name
        if (trimmedUrl.includes("localhost")) {
            urls.push("http://relay-server-sh:8080")
        }
        for (const pingUrl of urls) {
            try {
                const ping = $http.send({
                    url: pingUrl + "/ready",
                    method: "GET",
                    timeout: 10,
                })
                if (ping.statusCode === 200) {
                    reachable = true
                    break
                }
            } catch (_) {}
        }
        if (!reachable) {
            return c.json(400, { error: "Relay server is not reachable at " + serverUrl })
        }

        // Create provider record
        const providersCol = $app.dao().findCollectionByNameOrId("providers")
        provider = new Record(providersCol)
        provider.set("name", serverUrl)
        provider.set("url", serverUrl.replace(/\/$/, ""))
        provider.set("self_hosted", true)
        provider.set("public_key", $os.getenv("RELAY_PUBLIC_KEY") || "")
        provider.set("key_type", $os.getenv("RELAY_KEY_TYPE") || "EdDSA")
        provider.set("key_id", $os.getenv("RELAY_KEY_ID") || "self_hosted")
        $app.dao().saveRecord(provider)
    } else {
        return c.json(400, { error: "Either url or provider is required" })
    }

    // Create default storage quota for this relay
    let quota, relay
    try {
        const storageQuotasCol = $app.dao().findCollectionByNameOrId("storage_quotas")
        quota = new Record(storageQuotasCol)
        quota.set("name", "Default")
        quota.set("quota", 0)
        quota.set("usage", 0)
        quota.set("metered", false)
        quota.set("max_file_size", 0)
        $app.dao().saveRecord(quota)
        console.log("[self-host] storage quota created:", quota.id)
    } catch (err) {
        console.log("[self-host] FAILED to create storage quota:", err.message)
        return c.json(400, { error: "Failed to create storage quota: " + err.message })
    }

    // Create relay record
    try {
        const relaysCol = $app.dao().findCollectionByNameOrId("relays")
        relay = new Record(relaysCol)
        const hex = $security.randomStringWithAlphabet(32, "0123456789abcdef")
        const guid = hex.slice(0,8)+"-"+hex.slice(8,12)+"-4"+hex.slice(13,16)+"-"+hex.slice(16,20)+"-"+hex.slice(20,32)
        relay.set("guid", guid)
        relay.set("name", provider.get("name") || serverUrl || "Self-hosted Relay")
        relay.set("provider", provider.id)
        relay.set("version", "1.0.0")
        relay.set("user_limit", 0)
        relay.set("creator", userId)
        relay.set("cta", "")
        relay.set("plan", "free")
        relay.set("storage_quota", quota.id)
        $app.dao().saveRecord(relay)
        console.log("[self-host] relay created:", relay.id, "creator:", userId)
    } catch (err) {
        console.log("[self-host] FAILED to create relay:", err.message)
        return c.json(400, { error: "Failed to create relay: " + err.message })
    }

    // Grant the creating user Admin role on this relay
    try {
        const relayRolesCol = $app.dao().findCollectionByNameOrId("relay_roles")
        const rrRecord = new Record(relayRolesCol)
        rrRecord.set("user", userId)
        rrRecord.set("relay", relay.id)
        rrRecord.set("role", "4fq4b8kntyvzn1l") // Admin
        $app.dao().saveRecord(rrRecord)
        console.log("[self-host] relay role created for user:", userId)
    } catch (err) {
        console.log("[self-host] FAILED to create relay role:", err.message)
        return c.json(400, { error: "Failed to create relay role: " + err.message })
    }

    // Create default invitation key (Member role)
    try {
        const invitationsCol = $app.dao().findCollectionByNameOrId("relay_invitations")
        const invite = new Record(invitationsCol)
        invite.set("relay", relay.id)
        invite.set("role", "x6lllh2qsf9lxk6") // Member
        invite.set("key", $security.randomString(24))
        invite.set("enabled", true)
        $app.dao().saveRecord(invite)
        console.log("[self-host] invitation created for relay:", relay.id)
    } catch (err) {
        console.log("[self-host] FAILED to create invitation:", err.message)
        return c.json(400, { error: "Failed to create invitation: " + err.message })
    }

    $app.dao().expandRecord(relay, ["relay_invitations_via_relay", "relay_roles_via_relay"], null)
    return c.json(200, relay)
}, $apis.requireRecordAuth())


// GET /relay/:guid/check-host
// Called by LoginManager.checkRelayHost to verify a relay server is reachable.
routerAdd("GET", "/relay/:guid/check-host", (c) => {
    const info = $apis.requestInfo(c)
    if (!info.authRecord) {
        return c.json(401, { error: "Unauthorized" })
    }

    const guid = c.pathParam("guid")
    let relayUrl = $os.getenv("RELAY_SERVER_URL")

    try {
        const relay = $app.dao().findFirstRecordByFilter("relays", "guid = {:guid}", { "guid": guid })
        const providerId = relay.get("provider")
        if (providerId) {
            const provider = $app.dao().findRecordById("providers", providerId)
            const url = provider.get("url")
            if (url) relayUrl = url
        }
    } catch (_) {}

    if (!relayUrl) {
        return c.json(404, { error: "Relay not found" })
    }

    try {
        const ping = $http.send({ url: relayUrl + "/ready", method: "GET", timeout: 5 })
        return c.json(200, { ok: ping.statusCode === 200, status: ping.statusCode })
    } catch (err) {
        return c.json(200, { ok: false, error: err.message })
    }
}, $apis.requireRecordAuth())


// POST /api/accept-invitation
// Called by RelayManager.acceptInvitation when a user joins via share key.
// Input:  { key: string }
// Output: relay record
routerAdd("POST", "/api/accept-invitation", (c) => {
    const info = $apis.requestInfo(c)
    if (!info.authRecord) {
        return c.json(401, { error: "Unauthorized" })
    }

    const key    = info.data.key
    const userId = info.authRecord.id

    if (!key) {
        return c.json(400, { error: "Missing key" })
    }

    let invite
    try {
        invite = $app.dao().findFirstRecordByFilter(
            "relay_invitations",
            "key = {:key} && enabled = true",
            { "key": key }
        )
    } catch (_) {
        return c.json(404, { error: "Invitation not found or disabled" })
    }

    const relayId = invite.get("relay")

    // Check if user already has a role on this relay
    try {
        $app.dao().findFirstRecordByFilter(
            "relay_roles",
            "user = {:user} && relay = {:relay}",
            { "user": userId, "relay": relayId }
        )
        // Already a member — just return the relay
    } catch (_) {
        // Add as Member
        const relayRolesCol = $app.dao().findCollectionByNameOrId("relay_roles")
        const rr = new Record(relayRolesCol)
        rr.set("user", userId)
        rr.set("relay", relayId)
        rr.set("role", "x6lllh2qsf9lxk6") // Member
        $app.dao().saveRecord(rr)
    }

    const relay = $app.dao().findRecordById("relays", relayId)
    return c.json(200, relay)
}, $apis.requireRecordAuth())


// POST /api/rotate-key
// Called by RelayManager.rotateKey to regenerate an invitation key.
// Input:  { id: string }  (invitation ID)
// Output: relay_invitation record
routerAdd("POST", "/api/rotate-key", (c) => {
    const info = $apis.requestInfo(c)
    if (!info.authRecord) {
        return c.json(401, { error: "Unauthorized" })
    }

    const id = info.data.id
    if (!id) {
        return c.json(400, { error: "Missing invitation id" })
    }

    let invite
    try {
        invite = $app.dao().findRecordById("relay_invitations", id)
    } catch (_) {
        return c.json(404, { error: "Invitation not found" })
    }

    invite.set("key", $security.randomString(24))
    $app.dao().saveRecord(invite)

    return c.json(200, invite)
}, $apis.requireRecordAuth())
