// Reviewed schema additions for the virtual library, provider snapshots and reviews.
// The exact Git blob is pinned; editing a migration revokes its exemption.
// The normal production guard still blocks every unknown destructive migration.
import {createHash} from 'node:crypto';

export const reviewedAdditiveMigrations=Object.freeze({
  '0021_virtual_library.sql':'4a26973d3d73b26f50b991a944aa8fdbe4c0fca8',
  '0022_library_assets.sql':'94eec64b3671552c10e2c7434289ee6b4e9101de',
  '0023_review_source_versions.sql':'8af30fa4c1ba953c7791ebd7a6a98e421cfde943',
  '0024_library_upload_targets.sql':'7782c7f9657e4b52933ad6ada73252efdc90710d',
  '0025_review_sessions.sql':'1b2f2b2fb9e9a0b290c0699793f1756aefbbb08f',
  '0026_library_deletion_fences.sql':'c96a68417a1acd7f8d559229e9942a39028ed2c2',
  '0027_library_structure.sql':'68272c57274f74a2f113e4319a6bdc694d8e7536',
  '0028_drive_resource_keys.sql':'e9c6e772d62e215db892ee2baf7446e8ab92a04c',
  '0029_review_source_checks.sql':'461f8ba9cb23afd010a35f6c10691980db2f61d3',
  '0030_review_source_checksum.sql':'09cc99c00692dde60dd8b766b8ac97ba5326a9b3',
});

export function gitBlobSha(content){
 const buffer=Buffer.from(content,'utf8');
 return createHash('sha1').update(`blob ${buffer.byteLength}\0`).update(buffer).digest('hex');
}
export function isReviewedAdditiveMigration(name,content){
 const expected=reviewedAdditiveMigrations[name];
 return typeof expected==='string'&&gitBlobSha(content)===expected;
}
