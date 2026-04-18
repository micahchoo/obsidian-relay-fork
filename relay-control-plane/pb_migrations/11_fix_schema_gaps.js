/// <reference path="../pb_data/types.d.ts" />

migrate((db) => {
    const dao = Dao(db)

    // ── relays ───────────────────────────────────────────────────────────────
    const relays = dao.findCollectionByNameOrId("relays")

    // Add missing fields
    if (!relays.schema.getFieldByName("version")) {
        relays.schema.addField(new SchemaField({
            name: "version",
            type: "text",
            required: false,
            options: { default: "1.0.0" },
        }))
    }
    if (!relays.schema.getFieldByName("user_limit")) {
        relays.schema.addField(new SchemaField({
            name: "user_limit",
            type: "number",
            required: false,
            options: { default: 0 },
        }))
    }
    if (!relays.schema.getFieldByName("creator")) {
        relays.schema.addField(new SchemaField({
            name: "creator",
            type: "relation",
            required: false,
            options: { collectionId: dao.findCollectionByNameOrId("users").id, cascadeDelete: false },
        }))
    }
    if (!relays.schema.getFieldByName("cta")) {
        relays.schema.addField(new SchemaField({
            name: "cta",
            type: "text",
            required: false,
        }))
    }
    if (!relays.schema.getFieldByName("plan")) {
        relays.schema.addField(new SchemaField({
            name: "plan",
            type: "text",
            required: false,
            options: { default: "free" },
        }))
    }
    if (!relays.schema.getFieldByName("storage_quota")) {
        relays.schema.addField(new SchemaField({
            name: "storage_quota",
            type: "relation",
            required: false,
            options: { collectionId: dao.findCollectionByNameOrId("storage_quotas").id, cascadeDelete: false, maxSelect: 1 },
        }))
    }

    relays.updateRule = "@request.auth.id = creator"
    relays.deleteRule = "@request.auth.id = creator"
    dao.saveCollection(relays)

    // ── shared_folders ───────────────────────────────────────────────────────
    const sharedFolders = dao.findCollectionByNameOrId("shared_folders")

    if (!sharedFolders.schema.getFieldByName("name")) {
        sharedFolders.schema.addField(new SchemaField({
            name: "name",
            type: "text",
            required: false,
        }))
    }
    if (!sharedFolders.schema.getFieldByName("private")) {
        sharedFolders.schema.addField(new SchemaField({
            name: "private",
            type: "bool",
            required: false,
            options: { default: false },
        }))
    }

    sharedFolders.updateRule = "@request.auth.id = creator"
    sharedFolders.deleteRule = "@request.auth.id = creator"
    dao.saveCollection(sharedFolders)

    // ── relay_invitations ────────────────────────────────────────────────────
    const relayInvitations = dao.findCollectionByNameOrId("relay_invitations")

    if (!relayInvitations.schema.getFieldByName("role")) {
        relayInvitations.schema.addField(new SchemaField({
            name: "role",
            type: "relation",
            required: false,
            options: { collectionId: dao.findCollectionByNameOrId("roles").id, cascadeDelete: false },
        }))
    }

    relayInvitations.updateRule = "@request.auth.id != ''"
    relayInvitations.deleteRule = "@request.auth.id != ''"
    dao.saveCollection(relayInvitations)

    // ── shared_folder_roles ──────────────────────────────────────────────────
    // Greenfield: drop and recreate so the relation field is correctly named "shared_folder"
    dao.deleteCollection(dao.findCollectionByNameOrId("shared_folder_roles"))

    const sharedFolderRoles = new Collection({
        name: "shared_folder_roles",
        type: "base",
        schema: [
            {
                name: "user",
                type: "relation",
                required: true,
                options: { collectionId: dao.findCollectionByNameOrId("users").id, cascadeDelete: true },
            },
            {
                name: "shared_folder",
                type: "relation",
                required: true,
                options: { collectionId: dao.findCollectionByNameOrId("shared_folders").id, cascadeDelete: true },
            },
            {
                name: "role",
                type: "relation",
                required: false,
                options: { collectionId: dao.findCollectionByNameOrId("roles").id, cascadeDelete: false },
            },
        ],
        listRule:   "@request.auth.id != ''",
        viewRule:   "@request.auth.id != ''",
        createRule: "@request.auth.id != ''",
        updateRule: "@request.auth.id != ''",
        deleteRule: "@request.auth.id != ''",
    })
    dao.saveCollection(sharedFolderRoles)

    // ── storage_quotas ───────────────────────────────────────────────────────
    const storageQuotas = dao.findCollectionByNameOrId("storage_quotas")

    // Replace legacy "used" with "usage" to match frontend contract
    const usedField = storageQuotas.schema.getFieldByName("used")
    if (usedField && usedField.id) {
        storageQuotas.schema.removeField(usedField.id)
    }
    if (!storageQuotas.schema.getFieldByName("usage")) {
        storageQuotas.schema.addField(new SchemaField({
            name: "usage",
            type: "number",
            required: false,
            options: { default: 0 },
        }))
    }
    if (!storageQuotas.schema.getFieldByName("name")) {
        storageQuotas.schema.addField(new SchemaField({
            name: "name",
            type: "text",
            required: false,
        }))
    }
    if (!storageQuotas.schema.getFieldByName("metered")) {
        storageQuotas.schema.addField(new SchemaField({
            name: "metered",
            type: "bool",
            required: false,
            options: { default: false },
        }))
    }
    if (!storageQuotas.schema.getFieldByName("max_file_size")) {
        storageQuotas.schema.addField(new SchemaField({
            name: "max_file_size",
            type: "number",
            required: false,
            options: { default: 0 },
        }))
    }

    // Ensure relay relation points at relays and is optional (to avoid circular issues)
    const sqRelayField = storageQuotas.schema.getFieldByName("relay")
    if (sqRelayField) {
        sqRelayField.required = false
        sqRelayField.options.collectionId = dao.findCollectionByNameOrId("relays").id
        sqRelayField.options.cascadeDelete = true
    }

    // Ensure quota field exists and has default
    const quotaField = storageQuotas.schema.getFieldByName("quota")
    if (quotaField) {
        quotaField.required = false
        if (!quotaField.options) quotaField.options = {}
        quotaField.options.default = 0
    }

    storageQuotas.updateRule = "@request.auth.id != ''"
    storageQuotas.deleteRule = "@request.auth.id != ''"
    dao.saveCollection(storageQuotas)

    // ── relay_roles ──────────────────────────────────────────────────────────
    const relayRoles = dao.findCollectionByNameOrId("relay_roles")
    relayRoles.updateRule = "@request.auth.id != ''"
    relayRoles.deleteRule = "@request.auth.id != ''"
    dao.saveCollection(relayRoles)

    // ── subscriptions ────────────────────────────────────────────────────────
    const subscriptions = dao.findCollectionByNameOrId("subscriptions")
    subscriptions.updateRule = "@request.auth.id != ''"
    subscriptions.deleteRule = "@request.auth.id != ''"
    dao.saveCollection(subscriptions)

    // ── providers ────────────────────────────────────────────────────────────
    const providers = dao.findCollectionByNameOrId("providers")
    providers.updateRule = "@request.auth.id != ''"
    providers.deleteRule = "@request.auth.id != ''"
    dao.saveCollection(providers)

}, (db) => {
    // down — best-effort revert (not exhaustive because shared_folder_roles was recreated)
    const dao = Dao(db)

    try {
        const relays = dao.findCollectionByNameOrId("relays")
        relays.schema.removeField("version")
        relays.schema.removeField("user_limit")
        relays.schema.removeField("creator")
        relays.schema.removeField("cta")
        relays.schema.removeField("plan")
        relays.schema.removeField("storage_quota")
        relays.updateRule = null
        relays.deleteRule = null
        dao.saveCollection(relays)
    } catch (_) {}

    try {
        const sharedFolders = dao.findCollectionByNameOrId("shared_folders")
        sharedFolders.schema.removeField("name")
        sharedFolders.schema.removeField("private")
        sharedFolders.updateRule = null
        sharedFolders.deleteRule = null
        dao.saveCollection(sharedFolders)
    } catch (_) {}

    try {
        const relayInvitations = dao.findCollectionByNameOrId("relay_invitations")
        relayInvitations.schema.removeField("role")
        relayInvitations.updateRule = null
        relayInvitations.deleteRule = null
        dao.saveCollection(relayInvitations)
    } catch (_) {}

    try {
        const storageQuotas = dao.findCollectionByNameOrId("storage_quotas")
        storageQuotas.schema.removeField("usage")
        storageQuotas.schema.removeField("name")
        storageQuotas.schema.removeField("metered")
        storageQuotas.schema.removeField("max_file_size")
        storageQuotas.updateRule = null
        storageQuotas.deleteRule = null
        dao.saveCollection(storageQuotas)
    } catch (_) {}

    try {
        const relayRoles = dao.findCollectionByNameOrId("relay_roles")
        relayRoles.updateRule = null
        relayRoles.deleteRule = null
        dao.saveCollection(relayRoles)
    } catch (_) {}

    try {
        const subscriptions = dao.findCollectionByNameOrId("subscriptions")
        subscriptions.updateRule = null
        subscriptions.deleteRule = null
        dao.saveCollection(subscriptions)
    } catch (_) {}

    try {
        const providers = dao.findCollectionByNameOrId("providers")
        providers.updateRule = null
        providers.deleteRule = null
        dao.saveCollection(providers)
    } catch (_) {}
})
