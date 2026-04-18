/// <reference path="../pb_data/types.d.ts" />

migrate((db) => {
    // Fix relay_invitations to allow all authenticated users to create shares
    const relayInvitations = Dao(db).findCollectionByNameOrId("relay_invitations")
    
    // Allow any authenticated user to create an invitation
    relayInvitations.createRule = "@request.auth.id != ''"
    
    Dao(db).saveCollection(relayInvitations)
}, (db) => {
    // Revert to admin-only
    const relayInvitations = Dao(db).findCollectionByNameOrId("relay_invitations")
    relayInvitations.createRule = null
    Dao(db).saveCollection(relayInvitations)
})