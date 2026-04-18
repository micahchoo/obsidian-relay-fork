/// <reference path="../pb_data/types.d.ts" />

migrate((db) => {
    // Fix shared_folders to allow authenticated users to create
    const sharedFolders = Dao(db).findCollectionByNameOrId("shared_folders")
    sharedFolders.createRule = "@request.auth.id != ''"
    Dao(db).saveCollection(sharedFolders)

    // Also fix shared_folder_roles  
    const sharedFolderRoles = Dao(db).findCollectionByNameOrId("shared_folder_roles")
    sharedFolderRoles.createRule = "@request.auth.id != ''"
    Dao(db).saveCollection(sharedFolderRoles)

    // Fix oauth2_response - set reasonable maxFileSize for JSON data
    const oauth2Response = Dao(db).findCollectionByNameOrId("oauth2_response")
    // maxFileSize is in bytes - set to 5MB to allow storing OAuth response JSON
    oauth2Response.options = { maxFileSize: 5242880 }
    Dao(db).saveCollection(oauth2Response)
}, (db) => {
    // Revert
    const sharedFolders = Dao(db).findCollectionByNameOrId("shared_folders")
    sharedFolders.createRule = null
    Dao(db).saveCollection(sharedFolders)

    const sharedFolderRoles = Dao(db).findCollectionByNameOrId("shared_folder_roles")
    sharedFolderRoles.createRule = null
    Dao(db).saveCollection(sharedFolderRoles)

    const oauth2Response = Dao(db).findCollectionByNameOrId("oauth2_response")
    oauth2Response.options = { maxFileSize: 0 }
    Dao(db).saveCollection(oauth2Response)
})