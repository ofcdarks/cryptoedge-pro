//+------------------------------------------------------------------+
//|  CryptoEdge Pro — MT5 Integration Expert Advisor                 |
//|  Envia sinais para o CryptoEdge e registra trades automaticamente|
//+------------------------------------------------------------------+
#property copyright "CryptoEdge Pro"
#property version   "1.0"
#property strict

// ── Inputs ────────────────────────────────────────────────────────────
input string CryptoEdgeURL    = "https://seudominio.com"; // URL da sua plataforma
input string ApiKey           = "SUA_BINANCE_API_KEY";   // Binance API Key (como autenticação)
input bool   EnableSignalSend = true;   // Enviar trades ao CryptoEdge
input bool   EnablePollSignals= false;  // Receber sinais do CryptoEdge (experimental)
input int    PollIntervalSec  = 30;     // Intervalo de polling (segundos)

// ── Globals ───────────────────────────────────────────────────────────
datetime lastPoll = 0;

//+------------------------------------------------------------------+
//| Expert initialization                                              |
//+------------------------------------------------------------------+
int OnInit() {
   Print("CryptoEdge Pro EA iniciado. URL: ", CryptoEdgeURL);
   EventSetTimer(PollIntervalSec);
   return INIT_SUCCEEDED;
}

//+------------------------------------------------------------------+
//| Send trade to CryptoEdge                                          |
//+------------------------------------------------------------------+
bool SendTrade(string symbol, string direction, double entry, double exitPrice, 
               double size, int leverage, double pnl, double pnlPct, string result) {
   if (!EnableSignalSend) return false;
   
   string url = CryptoEdgeURL + "/api/webhook/signal";
   string headers = "Content-Type: application/json\r\nx-api-key: " + ApiKey + "\r\n";
   
   string body = StringFormat(
      "{\"symbol\":\"%s\",\"direction\":\"%s\",\"entry\":%.5f,\"exit\":%.5f,"
      "\"size\":%.2f,\"leverage\":%d,\"pnl\":%.2f,\"pnl_pct\":%.2f,"
      "\"result\":\"%s\",\"reason\":\"MT5 Auto Trade\"}",
      symbol, direction, entry, exitPrice, size, leverage, pnl, pnlPct, result
   );
   
   char postData[]; ArrayResize(postData, StringLen(body));
   StringToCharArray(body, postData, 0, StringLen(body));
   
   char result_data[]; string result_headers;
   int res = WebRequest("POST", url, headers, 5000, postData, result_data, result_headers);
   
   if (res == 200) {
      Print("[CryptoEdge] Trade enviado: ", direction, " ", symbol, " PnL:", pnl);
      return true;
   } else {
      Print("[CryptoEdge] Erro ao enviar trade. HTTP:", res);
      return false;
   }
}

//+------------------------------------------------------------------+
//| OnTrade - called when trades change                               |
//+------------------------------------------------------------------+
void OnTrade() {
   if (!EnableSignalSend) return;
   
   HistorySelect(TimeCurrent() - 86400, TimeCurrent());
   int total = HistoryDealsTotal();
   if (total < 1) return;
   
   ulong ticket = HistoryDealGetTicket(total - 1);
   if (ticket == 0) return;
   
   ENUM_DEAL_ENTRY dealEntry = (ENUM_DEAL_ENTRY)HistoryDealGetInteger(ticket, DEAL_ENTRY);
   if (dealEntry != DEAL_ENTRY_OUT && dealEntry != DEAL_ENTRY_OUT_BY) return;
   
   string  symbol    = HistoryDealGetString(ticket, DEAL_SYMBOL);
   double  profit    = HistoryDealGetDouble(ticket, DEAL_PROFIT);
   double  price     = HistoryDealGetDouble(ticket, DEAL_PRICE);
   double  volume    = HistoryDealGetDouble(ticket, DEAL_VOLUME);
   long    dealType  = HistoryDealGetInteger(ticket, DEAL_TYPE);
   string  direction = (dealType == DEAL_TYPE_BUY) ? "Long" : "Short";
   string  res       = (profit >= 0) ? "win" : "loss";
   
   SendTrade(symbol, direction, price, price, volume * price, 1, profit, 0, res);
}

//+------------------------------------------------------------------+
//| Poll CryptoEdge for new signals                                   |
//+------------------------------------------------------------------+
void OnTimer() {
   if (!EnablePollSignals) return;
   if (TimeCurrent() - lastPoll < PollIntervalSec) return;
   lastPoll = TimeCurrent();
   
   string url = CryptoEdgeURL + "/api/webhook/signals?key=" + ApiKey;
   char postData[0]; char result_data[]; string result_headers;
   int res = WebRequest("GET", url, "", 5000, postData, result_data, result_headers);
   
   if (res == 200) {
      string response = CharArrayToString(result_data);
      Print("[CryptoEdge] Sinais recebidos: ", response);
      // TODO: Parse JSON and act on signals
   }
}

void OnDeinit(const int reason) { EventKillTimer(); }
void OnTick() {}
//+------------------------------------------------------------------+
