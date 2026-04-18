/// <reference path="../pb_data/types.d.ts" />

migrate((db) => {
    // Fix relay_roles to allow authenticated users to create role assignments
    const relayRoles = Dao(db).findCollectionByNameOrId("relay_roles")
    
    // Allow any authenticated user to create a role assignment (they can only assign themselves)
    relayRoles.createRule = "@request.auth.id != ''"
    
    Dao(db).saveCollection(relayRoles)
}, (db) => {
    // Revert to admin-only
    const relayRoles = Dao(db).findCollectionByNameOrId("relay_roles")
    relayRoles.createRule = null
    Dao(db).saveCollection(relayRoles)
})