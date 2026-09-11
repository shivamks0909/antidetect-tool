<?php
/**
 * Opinion Insights Browser — Self-Hosted Update Endpoint
 *
 * Implements the Tauri updater protocol.
 * Client sends: GET /update?current_version=X&target=Y&arch=Z
 *
 * Returns:
 *   204 — No update available
 *   200 — Update available (Tauri-compatible JSON)
 *   500 — Server error
 */

header('Content-Type: application/json');
header('Access-Control-Allow-Origin: *');
header('Cache-Control: no-store, no-cache, must-revalidate, max-age=0');

// Configuration
$METADATA_PATH = __DIR__ . '/current.json';
$FILES_DIR     = __DIR__ . '/files';

// Validate request
$currentVersion = isset($_GET['current_version']) ? trim($_GET['current_version']) : '';
if ($currentVersion === '') {
    http_response_code(400);
    echo json_encode(['error' => 'Missing current_version parameter']);
    exit;
}

// Read metadata
if (!file_exists($METADATA_PATH)) {
    http_response_code(204);
    exit;
}

$metadataJson = file_get_contents($METADATA_PATH);
if ($metadataJson === false) {
    http_response_code(500);
    echo json_encode(['error' => 'Failed to read update metadata']);
    exit;
}

$metadata = json_decode($metadataJson, true);
if ($metadata === null || !isset($metadata['version'])) {
    http_response_code(500);
    echo json_encode(['error' => 'Invalid metadata format']);
    exit;
}

// SemVer comparison
$latestVersion = ltrim($metadata['version'], 'v');
$clientVersion = ltrim($currentVersion, 'v');

if (version_compare($clientVersion, $latestVersion, '>=')) {
    http_response_code(204);
    exit;
}

// Build Tauri updater response
$response = [
    'version'  => $metadata['version'],
    'notes'    => $metadata['notes'] ?? 'New version available.',
    'pub_date' => $metadata['pub_date'] ?? gmdate('c'),
];

if (isset($metadata['platforms']) && is_array($metadata['platforms'])) {
    $response['platforms'] = $metadata['platforms'];
} elseif (isset($metadata['url'])) {
    $response['url'] = $metadata['url'];
    if (isset($metadata['signature'])) {
        $response['signature'] = $metadata['signature'];
    }
}

http_response_code(200);
echo json_encode($response, JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES);
