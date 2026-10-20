<?php
/**
 * KADIS Digitals — Universal Form Handler (hardened)
 * -----------------------------------------------------------------
 * Point ANY form's action="" at this one file. It works for every
 * form on the site (Training Request, Request-a-Solution, Join Our
 * Team, and any future ones).
 *
 * SETUP: upload to the ROOT of kadisdigitals.com (same folder as
 * index.html). Uses PHP's built-in mail(). Needs PHP 7.0 or newer.
 *
 * PER-FORM SETUP (unchanged):
 *   - action="/send-form.php" method="POST"
 *   - hidden field: <input type="hidden" name="_category" value="Training Request">
 *   - optional:     <input type="hidden" name="_next" value="https://kadisdigitals.com/thank-you.html">
 *                   (only your own site's addresses are accepted)
 *   - optional spam trap: <input type="text" name="_gotcha" style="display:none">
 *
 * If a form submits via fetch() with "Accept: application/json" the
 * reply is { "ok": true/false } exactly as before.
 *
 * WHAT THIS VERSION ADDS (security):
 *   - Line breaks are stripped from anything that ends up in an email
 *     header, so nobody can slip in hidden Bcc/Cc recipients.
 *   - The visitor's email must be a valid address before it is used.
 *   - "_next" redirects only go to your own site (no phishing redirects).
 *   - Rate limits: max 5 submissions per visitor IP per 10 minutes, and
 *     the automatic "we received your request" email goes to the same
 *     address at most once an hour (and 60 per hour overall), so the form
 *     can't be used to spam strangers from your domain.
 *   - Size limits on the request, number of fields and length of each value.
 */

// ---------------- CONFIGURATION ----------------
$to          = 'admin@kadisdigitals.com';   // where YOU read and send from
$fromAddress = 'admin@kadisdigitals.com';   // same mailbox, both jobs
$fromName    = 'KADIS Website';
$siteName    = 'KADIS Digitals';
$whatsapp    = 'https://wa.me/2348061379390';

$allowedRedirectHosts = ['kadisdigitals.com', 'www.kadisdigitals.com'];
$sendAutoReply   = true;     // set false to stop emailing visitors a confirmation
$maxPerIp        = 5;        // submissions allowed per IP address...
$ipWindowSeconds = 600;      // ...within this many seconds
$maxFields       = 40;
$maxValueLength  = 3000;
$maxRequestBytes = 200000;

header('X-Content-Type-Options: nosniff');

// ---------------- REQUEST GUARDS ----------------
if (($_SERVER['REQUEST_METHOD'] ?? '') !== 'POST') {
    http_response_code(405);
    exit('Method not allowed');
}

if ((int) ($_SERVER['CONTENT_LENGTH'] ?? 0) > $maxRequestBytes) {
    http_response_code(413);
    exit('Request too large');
}

// Honeypot: if a bot filled this hidden field, pretend success and stop.
if (!empty($_POST['_gotcha'])) {
    respond(true, safe_redirect(isset($_POST['_next']) ? $_POST['_next'] : '', $allowedRedirectHosts));
}

// Per-visitor rate limit
$ip = isset($_SERVER['REMOTE_ADDR']) ? $_SERVER['REMOTE_ADDR'] : 'unknown';
if (rate_limited('ip:' . $ip, $maxPerIp, $ipWindowSeconds)) {
    respond(false, '', 429);
}

// ---------------- GATHER FIELDS ----------------
$category = clean_line(isset($_POST['_category']) ? $_POST['_category'] : '', 60);
if ($category === '') {
    $category = 'General Enquiry';
}
$redirect = safe_redirect(isset($_POST['_next']) ? $_POST['_next'] : '', $allowedRedirectHosts);
unset($_POST['_gotcha'], $_POST['_next'], $_POST['_category']);

$visitorEmail = clean_line((string) find_field($_POST, ['email', 'email address', 'e mail', 'e mail address']), 254);
if (!filter_var($visitorEmail, FILTER_VALIDATE_EMAIL)) {
    $visitorEmail = null;               // never put an unchecked address in a header
}
$visitorName = clean_line((string) find_field($_POST, ['name', 'full name']), 80);

// ---------------- BUILD NOTIFICATION BODY ----------------
$bodyLines = [];
$count = 0;
foreach ($_POST as $key => $value) {
    if (++$count > $maxFields) {
        break;
    }
    $label = clean_line(str_replace(['_', '-'], ' ', (string) $key), 40);
    if ($label === '') {
        continue;
    }
    if (is_array($value)) {
        $parts = [];
        foreach ($value as $v) {
            if (is_scalar($v) && (string) $v !== '') {
                $parts[] = (string) $v;
            }
        }
        $value = implode(', ', $parts);
    }
    $value = clean_text((string) $value, $maxValueLength);
    if ($value === '') {
        continue;
    }
    $bodyLines[] = ucwords($label) . ": {$value}";
}
$body = "New \"{$category}\" submission from {$siteName}\n"
      . "Received: " . date('Y-m-d H:i:s') . "\n"
      . str_repeat('-', 40) . "\n"
      . implode("\n", $bodyLines) . "\n";

// ---------------- SEND NOTIFICATION TO YOU ----------------
$subject = "[{$category}] New submission — {$siteName}";

$headers   = [];
$headers[] = "From: {$fromName} <{$fromAddress}>";
if ($visitorEmail) {
    $headers[] = "Reply-To: {$visitorEmail}";
}
$headers[] = "Content-Type: text/plain; charset=UTF-8";
$headers[] = "MIME-Version: 1.0";

$sent = @mail($to, $subject, $body, implode("\r\n", $headers));

// ---------------- OPTIONAL AUTO-REPLY TO THE VISITOR ----------------
if ($sendAutoReply && $sent && $visitorEmail
    && !rate_limited('ack:' . strtolower($visitorEmail), 1, 3600)
    && !rate_limited('ack-all', 60, 3600)) {

    $ackSubject = "We've received your request — {$siteName}";
    $ackBody = "Hi" . ($visitorName !== '' ? " {$visitorName}" : '') . ",\n\n"
        . "Thanks for reaching out to {$siteName}. We've received your "
        . strtolower($category) . " and a member of our team will get back "
        . "to you shortly.\n\n"
        . "If it's urgent, you can also reach us directly on WhatsApp: {$whatsapp}\n\n"
        . "— {$siteName}";

    $ackHeaders   = [];
    $ackHeaders[] = "From: {$fromName} <{$fromAddress}>";
    $ackHeaders[] = "Content-Type: text/plain; charset=UTF-8";
    $ackHeaders[] = "MIME-Version: 1.0";

    @mail($visitorEmail, $ackSubject, $ackBody, implode("\r\n", $ackHeaders));
}

// ---------------- RESPOND ----------------
respond($sent, $redirect);

// =================================================================

function find_field(array $fields, array $possibleNames)
{
    foreach ($fields as $key => $value) {
        if (is_array($value)) {
            continue;
        }
        $normalized = strtolower(str_replace(['_', '-'], ' ', (string) $key));
        foreach ($possibleNames as $name) {
            if ($normalized === $name) {
                return trim((string) $value);
            }
        }
    }
    return null;
}

/** One safe line: no control characters (so no CR/LF), collapsed spaces, length-limited. */
function clean_line($s, $max)
{
    $s = preg_replace('/[\x00-\x1F\x7F]+/', ' ', (string) $s);
    $s = trim(preg_replace('/\s{2,}/', ' ', $s));
    return cut($s, $max);
}

/** Multi-line text for the email BODY: keeps line breaks, drops other control characters. */
function clean_text($s, $max)
{
    $s = str_replace(["\r\n", "\r"], "\n", (string) $s);
    $s = preg_replace('/[\x00-\x09\x0B-\x1F\x7F]+/', '', $s);
    return cut(trim($s), $max);
}

function cut($s, $max)
{
    if (function_exists('mb_substr')) {
        return mb_substr($s, 0, $max, 'UTF-8');
    }
    return substr($s, 0, $max);
}

/** Only allow redirects to a path on this site, or to one of the allowed hosts. */
function safe_redirect($url, array $allowedHosts)
{
    $url = trim((string) $url);
    if ($url === '' || preg_match('/[\x00-\x1F\x7F\\\\]/', $url)) {
        return '';
    }
    if ($url[0] === '/') {
        return (isset($url[1]) && $url[1] === '/') ? '' : $url;
    }
    $parts = parse_url($url);
    if (!$parts || !isset($parts['scheme'], $parts['host'])) {
        return '';
    }
    if (!in_array(strtolower($parts['scheme']), ['http', 'https'], true)) {
        return '';
    }
    return in_array(strtolower($parts['host']), $allowedHosts, true) ? $url : '';
}

/**
 * Returns true if this bucket already used up its allowance in the time window.
 * Stores a tiny file per bucket in the server's temp folder. If that folder is
 * not writable it allows the request (the form keeps working).
 */
function rate_limited($bucket, $max, $windowSeconds)
{
    $dir = rtrim(sys_get_temp_dir(), '/\\') . '/kadis_forms';
    if (!is_dir($dir)) {
        @mkdir($dir, 0700, true);
    }
    $fh = @fopen($dir . '/' . hash('sha256', $bucket) . '.json', 'c+');
    if (!$fh) {
        return false;
    }
    flock($fh, LOCK_EX);
    $times = json_decode((string) stream_get_contents($fh), true);
    if (!is_array($times)) {
        $times = [];
    }
    $now = time();
    $recent = [];
    foreach ($times as $t) {
        if ($t > $now - $windowSeconds) {
            $recent[] = $t;
        }
    }
    $blocked = count($recent) >= $max;
    if (!$blocked) {
        $recent[] = $now;
        ftruncate($fh, 0);
        rewind($fh);
        fwrite($fh, json_encode($recent));
        fflush($fh);
    }
    flock($fh, LOCK_UN);
    fclose($fh);
    return $blocked;
}

function respond($sent, $redirect = '', $status = null)
{
    $wantsJson = isset($_SERVER['HTTP_ACCEPT'])
        && strpos($_SERVER['HTTP_ACCEPT'], 'application/json') !== false;
    $code = $status ? $status : ($sent ? 200 : 500);

    if ($wantsJson) {
        header('Content-Type: application/json');
        http_response_code($code);
        echo json_encode(['ok' => (bool) $sent]);
        exit;
    }

    if ($sent && $redirect) {
        header('Location: ' . $redirect);
        exit;
    }

    header('Content-Type: text/plain; charset=UTF-8');
    http_response_code($code);
    if ($status === 429) {
        echo 'Too many submissions from your connection. Please wait a few minutes, or contact us on WhatsApp.';
    } else {
        echo $sent
            ? 'Thank you — your submission has been received.'
            : 'Something went wrong sending your message. Please try WhatsApp instead.';
    }
    exit;
}
