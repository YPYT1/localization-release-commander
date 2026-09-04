ALTER TABLE assets DROP CONSTRAINT IF EXISTS assets_release_id_sha256_key;

CREATE UNIQUE INDEX assets_release_kind_language_parent_sha256_uidx
ON assets (
  release_id,
  kind,
  COALESCE(language, ''),
  COALESCE(parent_asset_id, '00000000-0000-0000-0000-000000000000'::uuid),
  sha256
);
