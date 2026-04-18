/// <reference path="../pb_data/types.d.ts" />

migrate((db) => {
    // ── users (auth collection) ──────────────────────────────────────────────
    // PocketBase auto-creates the users collection on init — update it instead of creating.
    const users = Dao(db).findCollectionByNameOrId("users")
    users.options = {
        allowOAuth2Auth:    true,
        allowEmailAuth:     false,
        allowUsernameAuth:  false,
        requireEmail:       true,
    }
    // Add avatarUrl if not present (name field already exists by default)
    if (!users.schema.getFieldByName("avatarUrl")) {
        users.schema.addField(new SchemaField({ name: "avatarUrl", type: "url", required: false }))
    }
    users.listRule   = "@request.auth.id != ''"
    users.viewRule   = "@request.auth.id != ''"
    users.createRule = null
    users.updateRule = "@request.auth.id = id"
    users.deleteRule = null
    Dao(db).saveCollection(users)

    // ── roles ────────────────────────────────────────────────────────────────
    // IDs are hardcoded in the Relay plugin (RelayManager.ts)
    const roles = new Collection({
        name: "roles",
        type: "base",
        schema: [
            { name: "name", type: "text", required: true },
        ],
        listRule:   "@request.auth.id != ''",
        viewRule:   "@request.auth.id != ''",
        createRule: null,
        updateRule: null,
        deleteRule: null,
    })
    Dao(db).saveCollection(roles)

    // Seed roles with the exact IDs the plugin expects
    const rolesDao = Dao(db)
    const adminRole = new Record(rolesDao.findCollectionByNameOrId("roles"))
    adminRole.setId("4fq4b8kntyvzn1l")
    adminRole.set("name", "Admin")
    rolesDao.saveRecord(adminRole)

    const memberRole = new Record(rolesDao.findCollectionByNameOrId("roles"))
    memberRole.setId("x6lllh2qsf9lxk6")
    memberRole.set("name", "Member")
    rolesDao.saveRecord(memberRole)

    // ── providers ────────────────────────────────────────────────────────────
    const providers = new Collection({
        name: "providers",
        type: "base",
        schema: [
            { name: "name",        type: "text",    required: true },
            { name: "url",         type: "url",     required: true },
            { name: "self_hosted", type: "bool",    required: false },
            { name: "public_key",  type: "text",    required: false },
            { name: "key_type",    type: "text",    required: false },
            { name: "key_id",      type: "text",    required: false },
        ],
        listRule:   "@request.auth.id != ''",
        viewRule:   "@request.auth.id != ''",
        createRule: null,
        updateRule: null,
        deleteRule: null,
    })
    Dao(db).saveCollection(providers)

    // ── relays ───────────────────────────────────────────────────────────────
    const relays = new Collection({
        name: "relays",
        type: "base",
        schema: [
            { name: "guid",     type: "text", required: true },
            { name: "name",     type: "text", required: true },
            { name: "path",     type: "text", required: false },
            {
                name: "provider",
                type: "relation",
                required: false,
                options: { collectionId: "_pb_users_auth_", cascadeDelete: false },
            },
        ],
        listRule:   "@request.auth.id != ''",
        viewRule:   "@request.auth.id != ''",
        createRule: "@request.auth.id != ''",
        updateRule: null,
        deleteRule: null,
    })
    Dao(db).saveCollection(relays)

    // Fix provider relation to point at providers collection
    const relaysCol = Dao(db).findCollectionByNameOrId("relays")
    const providersCol = Dao(db).findCollectionByNameOrId("providers")
    const providerField = relaysCol.schema.getFieldByName("provider")
    providerField.options.collectionId = providersCol.id
    Dao(db).saveCollection(relaysCol)

    // ── relay_roles ──────────────────────────────────────────────────────────
    const relayRoles = new Collection({
        name: "relay_roles",
        type: "base",
        schema: [
            {
                name: "user",
                type: "relation",
                required: true,
                options: { collectionId: "_pb_users_auth_", cascadeDelete: true },
            },
            {
                name: "relay",
                type: "relation",
                required: true,
                options: { collectionId: "_pb_users_auth_", cascadeDelete: true },
            },
            {
                name: "role",
                type: "relation",
                required: true,
                options: { collectionId: "_pb_users_auth_", cascadeDelete: false },
            },
        ],
        listRule:   "@request.auth.id != ''",
        viewRule:   "@request.auth.id != ''",
        createRule: null,
        updateRule: null,
        deleteRule: null,
    })
    Dao(db).saveCollection(relayRoles)

    // Fix relay_roles relations
    const relayRolesCol = Dao(db).findCollectionByNameOrId("relay_roles")
    const usersCol = Dao(db).findCollectionByNameOrId("users")
    const relaysCol2 = Dao(db).findCollectionByNameOrId("relays")
    const rolesCol = Dao(db).findCollectionByNameOrId("roles")
    relayRolesCol.schema.getFieldByName("user").options.collectionId = usersCol.id
    relayRolesCol.schema.getFieldByName("relay").options.collectionId = relaysCol2.id
    relayRolesCol.schema.getFieldByName("role").options.collectionId = rolesCol.id
    Dao(db).saveCollection(relayRolesCol)

    // ── relay_invitations ────────────────────────────────────────────────────
    const relayInvitations = new Collection({
        name: "relay_invitations",
        type: "base",
        schema: [
            {
                name: "relay",
                type: "relation",
                required: true,
                options: { collectionId: "_pb_users_auth_", cascadeDelete: true },
            },
            { name: "key",     type: "text", required: true },
            { name: "enabled", type: "bool", required: false },
        ],
        listRule:   "@request.auth.id != ''",
        viewRule:   "@request.auth.id != ''",
        createRule: null,
        updateRule: null,
        deleteRule: null,
    })
    Dao(db).saveCollection(relayInvitations)
    const riCol = Dao(db).findCollectionByNameOrId("relay_invitations")
    riCol.schema.getFieldByName("relay").options.collectionId = Dao(db).findCollectionByNameOrId("relays").id
    Dao(db).saveCollection(riCol)

    // ── shared_folders ───────────────────────────────────────────────────────
    const sharedFolders = new Collection({
        name: "shared_folders",
        type: "base",
        schema: [
            {
                name: "relay",
                type: "relation",
                required: true,
                options: { collectionId: "_pb_users_auth_", cascadeDelete: true },
            },
            {
                name: "creator",
                type: "relation",
                required: false,
                options: { collectionId: "_pb_users_auth_", cascadeDelete: false },
            },
            { name: "path", type: "text", required: false },
            { name: "guid", type: "text", required: false },
        ],
        listRule:   "@request.auth.id != ''",
        viewRule:   "@request.auth.id != ''",
        createRule: null,
        updateRule: null,
        deleteRule: null,
    })
    Dao(db).saveCollection(sharedFolders)
    const sfCol = Dao(db).findCollectionByNameOrId("shared_folders")
    sfCol.schema.getFieldByName("relay").options.collectionId = Dao(db).findCollectionByNameOrId("relays").id
    sfCol.schema.getFieldByName("creator").options.collectionId = Dao(db).findCollectionByNameOrId("users").id
    Dao(db).saveCollection(sfCol)

    // ── shared_folder_roles ──────────────────────────────────────────────────
    const sharedFolderRoles = new Collection({
        name: "shared_folder_roles",
        type: "base",
        schema: [
            {
                name: "user",
                type: "relation",
                required: true,
                options: { collectionId: "_pb_users_auth_", cascadeDelete: true },
            },
            {
                name: "folder",
                type: "relation",
                required: true,
                options: { collectionId: "_pb_users_auth_", cascadeDelete: true },
            },
            {
                name: "role",
                type: "relation",
                required: false,
                options: { collectionId: "_pb_users_auth_", cascadeDelete: false },
            },
        ],
        listRule:   "@request.auth.id != ''",
        viewRule:   "@request.auth.id != ''",
        createRule: null,
        updateRule: null,
        deleteRule: null,
    })
    Dao(db).saveCollection(sharedFolderRoles)
    const sfrCol = Dao(db).findCollectionByNameOrId("shared_folder_roles")
    sfrCol.schema.getFieldByName("user").options.collectionId = Dao(db).findCollectionByNameOrId("users").id
    sfrCol.schema.getFieldByName("folder").options.collectionId = Dao(db).findCollectionByNameOrId("shared_folders").id
    sfrCol.schema.getFieldByName("role").options.collectionId = Dao(db).findCollectionByNameOrId("roles").id
    Dao(db).saveCollection(sfrCol)

    // ── subscriptions ────────────────────────────────────────────────────────
    const subscriptions = new Collection({
        name: "subscriptions",
        type: "base",
        schema: [
            {
                name: "user",
                type: "relation",
                required: true,
                options: { collectionId: "_pb_users_auth_", cascadeDelete: true },
            },
            {
                name: "relay",
                type: "relation",
                required: true,
                options: { collectionId: "_pb_users_auth_", cascadeDelete: true },
            },
            { name: "active",            type: "bool",   required: false },
            { name: "token",             type: "text",   required: false },
            { name: "stripe_cancel_at",  type: "number", required: false },
            { name: "stripe_quantity",   type: "number", required: false },
        ],
        listRule:   "@request.auth.id != ''",
        viewRule:   "@request.auth.id != ''",
        createRule: null,
        updateRule: null,
        deleteRule: null,
    })
    Dao(db).saveCollection(subscriptions)
    const subCol = Dao(db).findCollectionByNameOrId("subscriptions")
    subCol.schema.getFieldByName("user").options.collectionId = Dao(db).findCollectionByNameOrId("users").id
    subCol.schema.getFieldByName("relay").options.collectionId = Dao(db).findCollectionByNameOrId("relays").id
    Dao(db).saveCollection(subCol)

    // ── storage_quotas ───────────────────────────────────────────────────────
    const storageQuotas = new Collection({
        name: "storage_quotas",
        type: "base",
        schema: [
            {
                name: "relay",
                type: "relation",
                required: false,
                options: { collectionId: "_pb_users_auth_", cascadeDelete: true },
            },
            { name: "used",  type: "number", required: false },
            { name: "quota", type: "number", required: false },
        ],
        listRule:   "@request.auth.id != ''",
        viewRule:   "@request.auth.id != ''",
        createRule: null,
        updateRule: null,
        deleteRule: null,
    })
    Dao(db).saveCollection(storageQuotas)
    const sqCol = Dao(db).findCollectionByNameOrId("storage_quotas")
    sqCol.schema.getFieldByName("relay").options.collectionId = Dao(db).findCollectionByNameOrId("relays").id
    Dao(db).saveCollection(sqCol)

    // ── oauth2_response ──────────────────────────────────────────────────────
    const oauth2Response = new Collection({
        name: "oauth2_response",
        type: "base",
        schema: [
            {
                name: "user",
                type: "relation",
                required: true,
                options: { collectionId: "_pb_users_auth_", cascadeDelete: true },
            },
            { name: "oauth_response", type: "json", required: false },
        ],
        listRule:   null,
        viewRule:   null,
        createRule: "@request.auth.id != ''",
        updateRule: null,
        deleteRule: null,
    })
    Dao(db).saveCollection(oauth2Response)
    const o2Col = Dao(db).findCollectionByNameOrId("oauth2_response")
    o2Col.schema.getFieldByName("user").options.collectionId = Dao(db).findCollectionByNameOrId("users").id
    Dao(db).saveCollection(o2Col)

    // ── code_exchange ────────────────────────────────────────────────────────
    // Records are keyed by first 15 chars of OAuth state. Plugin polls getOne(state[:15]).
    const codeExchange = new Collection({
        name: "code_exchange",
        type: "base",
        schema: [
            { name: "code",  type: "text", required: true },
            { name: "state", type: "text", required: false },
        ],
        listRule:   null,
        viewRule:   null,
        createRule: "",
        updateRule: null,
        deleteRule: null,
    })
    Dao(db).saveCollection(codeExchange)

}, (db) => {
    // down — reverse order
    for (const name of [
        "code_exchange", "oauth2_response", "storage_quotas",
        "subscriptions", "shared_folder_roles", "shared_folders",
        "relay_invitations", "relay_roles", "relays", "providers",
        "roles",
        // "users" intentionally omitted — auto-created by PocketBase, can't delete
    ]) {
        try { Dao(db).deleteCollection(Dao(db).findCollectionByNameOrId(name)) } catch(_) {}
    }
})
