/// <reference path="../pb_data/types.d.ts" />

migrate((db) => {
    const dao = Dao(db)
    const storageQuotas = dao.findCollectionByNameOrId("storage_quotas")

    const usedField = storageQuotas.schema.getFieldByName("used")
    if (usedField && usedField.id) {
        storageQuotas.schema.removeField(usedField.id)
        dao.saveCollection(storageQuotas)
    }
}, (db) => {
    const dao = Dao(db)
    const storageQuotas = dao.findCollectionByNameOrId("storage_quotas")

    if (!storageQuotas.schema.getFieldByName("used")) {
        storageQuotas.schema.addField(new SchemaField({
            name: "used",
            type: "number",
            required: false,
        }))
        dao.saveCollection(storageQuotas)
    }
})
