<?php
// Recebe os dados de mecanizacao ja normalizados pelo navegador (js/importar.js)
// e grava em data/mecanizacao.json, que o painel passa a ler no lugar do
// arquivo embutido js/dados-mecanizacao.js.
//
// A conferencia de senha aqui e o mesmo hash usado nas paginas: serve para
// evitar gravacao acidental, NAO e autenticacao forte (o hash trafega e pode
// ser reaproveitado). Se este painel for exposto fora da rede interna, troque
// por autenticacao de verdade no servidor.
header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store');

const HASH_ADMIN = '8c6976e5b5410415bde908bd4dee15dfb167a9c873fc4bb8a81f6f2ab448a918';

$destino = __DIR__ . '/data/mecanizacao.json';
$backup  = __DIR__ . '/data/mecanizacao-anterior.json';
$metodo  = $_SERVER['REQUEST_METHOD'];

function erro($codigo, $msg){
  http_response_code($codigo);
  echo json_encode(['ok' => false, 'erro' => $msg], JSON_UNESCAPED_UNICODE);
  exit;
}

if($metodo === 'GET'){
  // Devolve o que esta publicado (o painel usa isso no carregamento).
  if(!file_exists($destino)) erro(404, 'Nenhum dado publicado ainda.');
  header('Content-Type: application/json; charset=utf-8');
  readfile($destino);
  exit;
}

if($metodo !== 'POST') erro(405, 'Metodo nao permitido.');

$raw = file_get_contents('php://input');
if(strlen($raw) > 40 * 1024 * 1024) erro(413, 'Arquivo muito grande.');

$entrada = json_decode($raw, true);
if(!is_array($entrada)) erro(400, 'Corpo da requisicao nao e JSON valido.');

if(!isset($entrada['senha']) || hash('sha256', (string)$entrada['senha']) !== HASH_ADMIN){
  erro(403, 'Senha de administrador incorreta.');
}

$pacote = isset($entrada['dados']) ? $entrada['dados'] : null;
if(!is_array($pacote) || !isset($pacote['registros']) || !is_array($pacote['registros'])){
  erro(400, 'Pacote de dados invalido: falta a lista de registros.');
}
if(count($pacote['registros']) < 1){
  erro(400, 'A planilha enviada nao tem nenhuma linha de dados.');
}

// Confere se os registros tem a forma esperada (amostra das 5 primeiras linhas).
$obrigatorios = ['d', 'pc', 'mun', 'esc', 'cult', 'ha', 'hrs', 'ac'];
foreach(array_slice($pacote['registros'], 0, 5) as $i => $reg){
  if(!is_array($reg)) erro(400, "Registro $i nao e um objeto.");
  foreach($obrigatorios as $campo){
    if(!array_key_exists($campo, $reg)) erro(400, "Registro $i sem o campo obrigatorio \"$campo\".");
  }
}

if(!is_dir(__DIR__ . '/data')){
  if(!mkdir(__DIR__ . '/data', 0775, true)) erro(500, 'Nao foi possivel criar a pasta data/.');
}

// Guarda a versao anterior antes de sobrescrever.
if(file_exists($destino)){
  @copy($destino, $backup);
}

$pacote['meta'] = is_array($pacote['meta'] ?? null) ? $pacote['meta'] : [];
$pacote['meta']['publicado_em'] = date('d/m/Y H:i');

$json = json_encode($pacote, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
if($json === false) erro(500, 'Falha ao serializar os dados.');

if(file_put_contents($destino, $json, LOCK_EX) === false){
  erro(500, 'Falha ao gravar data/mecanizacao.json (verifique a permissao de escrita).');
}

echo json_encode([
  'ok' => true,
  'registros' => count($pacote['registros']),
  'publicado_em' => $pacote['meta']['publicado_em'],
  'backup' => file_exists($backup)
], JSON_UNESCAPED_UNICODE);
