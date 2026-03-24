package db

import (
	"errors"
	"strings"
	"time"

	"eve-flipper/internal/config"
)

func normalizeImportExportWarehouse(warehouse config.ImportExportWarehouse) config.ImportExportWarehouse {
	warehouse.Name = strings.TrimSpace(warehouse.Name)
	warehouse.SystemName = strings.TrimSpace(warehouse.SystemName)
	warehouse.LocationName = strings.TrimSpace(warehouse.LocationName)
	warehouse.OwnerKind = strings.ToLower(strings.TrimSpace(warehouse.OwnerKind))
	warehouse.CorporationName = strings.TrimSpace(warehouse.CorporationName)
	if warehouse.OwnerKind == "" {
		warehouse.OwnerKind = "character"
	}
	if warehouse.OwnerKind != "corporation" {
		warehouse.OwnerKind = "character"
		warehouse.CorporationID = 0
		warehouse.CorporationName = ""
	}
	if warehouse.Name == "" {
		warehouse.Name = warehouse.LocationName
	}
	return warehouse
}

func normalizeImportExportTransitEntry(entry config.ImportExportTransitEntry) config.ImportExportTransitEntry {
	entry.FromSystemName = strings.TrimSpace(entry.FromSystemName)
	entry.FromLocationName = strings.TrimSpace(entry.FromLocationName)
	entry.ToSystemName = strings.TrimSpace(entry.ToSystemName)
	entry.ToLocationName = strings.TrimSpace(entry.ToLocationName)
	for i := range entry.Items {
		entry.Items[i].TypeName = strings.TrimSpace(entry.Items[i].TypeName)
	}
	return entry
}

func (d *DB) ListImportExportWarehousesForUser(userID string) ([]config.ImportExportWarehouse, error) {
	userID = normalizeUserID(userID)
	rows, err := d.sql.Query(`
		SELECT id, name, system_id, system_name, location_id, location_name, is_structure,
		       owner_kind, corporation_id, corporation_name, created_at, updated_at
		  FROM import_export_warehouses
		 WHERE user_id = ?
		 ORDER BY updated_at DESC, id DESC
	`, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var warehouses []config.ImportExportWarehouse
	for rows.Next() {
		var warehouse config.ImportExportWarehouse
		if err := rows.Scan(
			&warehouse.ID,
			&warehouse.Name,
			&warehouse.SystemID,
			&warehouse.SystemName,
			&warehouse.LocationID,
			&warehouse.LocationName,
			&warehouse.IsStructure,
			&warehouse.OwnerKind,
			&warehouse.CorporationID,
			&warehouse.CorporationName,
			&warehouse.CreatedAt,
			&warehouse.UpdatedAt,
		); err != nil {
			return nil, err
		}
		warehouses = append(warehouses, warehouse)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	if warehouses == nil {
		return []config.ImportExportWarehouse{}, nil
	}
	return warehouses, nil
}

func (d *DB) CreateImportExportWarehouseForUser(userID string, warehouse config.ImportExportWarehouse) (config.ImportExportWarehouse, error) {
	userID = normalizeUserID(userID)
	warehouse = normalizeImportExportWarehouse(warehouse)
	if warehouse.SystemID <= 0 || warehouse.LocationID <= 0 {
		return config.ImportExportWarehouse{}, errors.New("system and location are required")
	}
	if warehouse.SystemName == "" || warehouse.LocationName == "" {
		return config.ImportExportWarehouse{}, errors.New("system and location names are required")
	}
	if warehouse.OwnerKind == "corporation" && warehouse.CorporationID <= 0 {
		return config.ImportExportWarehouse{}, errors.New("corporation warehouses require a corporation")
	}
	now := time.Now().UTC().Format(time.RFC3339)
	res, err := d.sql.Exec(`
		INSERT INTO import_export_warehouses (
			user_id, name, system_id, system_name, location_id, location_name, is_structure,
			owner_kind, corporation_id, corporation_name, created_at, updated_at
		) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
	`, userID, warehouse.Name, warehouse.SystemID, warehouse.SystemName, warehouse.LocationID, warehouse.LocationName, warehouse.IsStructure, warehouse.OwnerKind, warehouse.CorporationID, warehouse.CorporationName, now, now)
	if err != nil {
		return config.ImportExportWarehouse{}, err
	}
	id, err := res.LastInsertId()
	if err != nil {
		return config.ImportExportWarehouse{}, err
	}
	warehouse.ID = id
	warehouse.CreatedAt = now
	warehouse.UpdatedAt = now
	return warehouse, nil
}

func (d *DB) DeleteImportExportWarehouseForUser(userID string, warehouseID int64) error {
	userID = normalizeUserID(userID)
	_, err := d.sql.Exec(`DELETE FROM import_export_warehouses WHERE user_id = ? AND id = ?`, userID, warehouseID)
	return err
}

func (d *DB) ListImportExportTransitEntriesForUser(userID string) ([]config.ImportExportTransitEntry, error) {
	userID = normalizeUserID(userID)
	rows, err := d.sql.Query(`
		SELECT id, from_system_id, from_system_name, from_location_id, from_location_name,
		       to_system_id, to_system_name, to_location_id, to_location_name, created_at, updated_at
		  FROM import_export_transit_entries
		 WHERE user_id = ?
		 ORDER BY updated_at DESC, id DESC
	`, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var entries []config.ImportExportTransitEntry
	for rows.Next() {
		var entry config.ImportExportTransitEntry
		if err := rows.Scan(
			&entry.ID,
			&entry.FromSystemID,
			&entry.FromSystemName,
			&entry.FromLocationID,
			&entry.FromLocationName,
			&entry.ToSystemID,
			&entry.ToSystemName,
			&entry.ToLocationID,
			&entry.ToLocationName,
			&entry.CreatedAt,
			&entry.UpdatedAt,
		); err != nil {
			return nil, err
		}
		entries = append(entries, entry)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	for i := range entries {
		itemRows, itemErr := d.sql.Query(`
			SELECT type_id, type_name, quantity
			  FROM import_export_transit_entry_items
			 WHERE entry_id = ?
			 ORDER BY id ASC
		`, entries[i].ID)
		if itemErr != nil {
			return nil, itemErr
		}
		items := make([]config.ImportExportTransitItem, 0)
		for itemRows.Next() {
			var item config.ImportExportTransitItem
			if err := itemRows.Scan(&item.TypeID, &item.TypeName, &item.Quantity); err != nil {
				itemRows.Close()
				return nil, err
			}
			items = append(items, item)
		}
		if err := itemRows.Err(); err != nil {
			itemRows.Close()
			return nil, err
		}
		itemRows.Close()
		entries[i].Items = items
	}
	if entries == nil {
		return []config.ImportExportTransitEntry{}, nil
	}
	return entries, nil
}

func (d *DB) CreateImportExportTransitEntryForUser(userID string, entry config.ImportExportTransitEntry) (config.ImportExportTransitEntry, error) {
	userID = normalizeUserID(userID)
	entry = normalizeImportExportTransitEntry(entry)
	if entry.FromSystemID <= 0 || entry.ToSystemID <= 0 {
		return config.ImportExportTransitEntry{}, errors.New("source and destination systems are required")
	}
	if entry.FromSystemName == "" || entry.ToSystemName == "" {
		return config.ImportExportTransitEntry{}, errors.New("source and destination system names are required")
	}
	if entry.FromLocationID <= 0 || entry.ToLocationID <= 0 {
		return config.ImportExportTransitEntry{}, errors.New("source and destination locations are required")
	}
	if entry.FromLocationName == "" || entry.ToLocationName == "" {
		return config.ImportExportTransitEntry{}, errors.New("source and destination location names are required")
	}
	if len(entry.Items) == 0 {
		return config.ImportExportTransitEntry{}, errors.New("at least one transit item is required")
	}
	for _, item := range entry.Items {
		if item.TypeID <= 0 || item.TypeName == "" {
			return config.ImportExportTransitEntry{}, errors.New("all transit items must have a valid type")
		}
		if item.Quantity <= 0 {
			return config.ImportExportTransitEntry{}, errors.New("all transit item quantities must be positive")
		}
	}
	now := time.Now().UTC().Format(time.RFC3339)
	tx, err := d.sql.Begin()
	if err != nil {
		return config.ImportExportTransitEntry{}, err
	}
	defer tx.Rollback()
	res, err := tx.Exec(`
		INSERT INTO import_export_transit_entries (
			user_id, from_system_id, from_system_name, from_location_id, from_location_name,
			to_system_id, to_system_name, to_location_id, to_location_name, created_at, updated_at
		) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
	`, userID, entry.FromSystemID, entry.FromSystemName, entry.FromLocationID, entry.FromLocationName, entry.ToSystemID, entry.ToSystemName, entry.ToLocationID, entry.ToLocationName, now, now)
	if err != nil {
		return config.ImportExportTransitEntry{}, err
	}
	id, err := res.LastInsertId()
	if err != nil {
		return config.ImportExportTransitEntry{}, err
	}
	for _, item := range entry.Items {
		if _, err := tx.Exec(`
			INSERT INTO import_export_transit_entry_items (entry_id, type_id, type_name, quantity)
			VALUES (?, ?, ?, ?)
		`, id, item.TypeID, item.TypeName, item.Quantity); err != nil {
			return config.ImportExportTransitEntry{}, err
		}
	}
	if err := tx.Commit(); err != nil {
		return config.ImportExportTransitEntry{}, err
	}
	entry.ID = id
	entry.CreatedAt = now
	entry.UpdatedAt = now
	if entry.Items == nil {
		entry.Items = []config.ImportExportTransitItem{}
	}
	return entry, nil
}

func (d *DB) DeleteImportExportTransitEntryForUser(userID string, entryID int64) error {
	userID = normalizeUserID(userID)
	_, err := d.sql.Exec(`DELETE FROM import_export_transit_entries WHERE user_id = ? AND id = ?`, userID, entryID)
	return err
}
