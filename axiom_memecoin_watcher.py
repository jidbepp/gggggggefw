#!/usr/bin/env python3
"""Paper-trading meme-coin watcher with a start/stop GUI.

This is a safety-first scaffold. It does not guarantee profit, detect pumps before
other market participants, or automate against axiom.trade. Wire only legitimate
market-data and order APIs that you are authorized to use.
"""

from __future__ import annotations

import argparse
import json
import random
import threading
import time
import tkinter as tk
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from tkinter import ttk
from typing import Iterable


@dataclass
class TradeConfig:
    quote_asset: str = "USD"
    slippage_bps: int = 75
    order_timeout_seconds: int = 15
    allow_live_orders: bool = False


@dataclass
class RiskConfig:
    max_position_usd: float = 25.0
    max_open_positions: int = 3
    stop_loss_pct: float = 12.0
    take_profit_pct: float = 35.0
    trailing_stop_pct: float = 10.0
    daily_loss_limit_usd: float = 75.0
    cooldown_seconds: int = 120
    min_liquidity_usd: float = 8_000.0
    max_top10_holder_pct: float = 45.0
    max_buy_tax_pct: float = 5.0
    max_sell_tax_pct: float = 5.0
    minimum_score: int = 72


@dataclass
class WatchlistConfig:
    min_age_minutes: float = 1.0
    max_age_minutes: float = 120.0
    max_market_cap_usd: float = 250_000.0
    min_volume_acceleration: float = 1.8
    max_volume_acceleration: float = 8.0
    min_price_change_5m_pct: float = 3.0
    max_price_change_5m_pct: float = 35.0


@dataclass
class AppConfig:
    mode: str = "paper"
    poll_seconds: float = 3.0
    virtual_balance_usd: float = 1_000.0
    log_path: str = "trade_audit.jsonl"
    trade: TradeConfig = field(default_factory=TradeConfig)
    risk: RiskConfig = field(default_factory=RiskConfig)
    watchlist: WatchlistConfig = field(default_factory=WatchlistConfig)

    @property
    def paper_mode(self) -> bool:
        return self.mode != "live" or not self.trade.allow_live_orders


@dataclass
class TokenCandidate:
    symbol: str
    address: str
    price_usd: float
    liquidity_usd: float
    volume_5m_usd: float
    volume_1h_usd: float
    price_change_5m_pct: float
    top10_holder_pct: float
    buy_tax_pct: float
    sell_tax_pct: float
    contract_verified: bool
    mint_disabled: bool
    liquidity_locked: bool
    age_minutes: float
    market_cap_usd: float


@dataclass
class Position:
    symbol: str
    address: str
    entry_price: float
    size_usd: float
    opened_at: str


class MarketDataProvider:
    """Replace this provider with authorized Axiom/API market data."""

    def fetch_candidates(self) -> Iterable[TokenCandidate]:
        symbols = ["BONKX", "PEPEAI", "WOJAK2", "MOONL", "DOGGO", "FROG"]
        for symbol in random.sample(symbols, k=4):
            yield TokenCandidate(
                symbol=symbol,
                address="0x" + "".join(random.choices("abcdef0123456789", k=40)),
                price_usd=round(random.uniform(0.000001, 0.003), 8),
                liquidity_usd=random.uniform(2_000, 80_000),
                volume_5m_usd=random.uniform(100, 30_000),
                volume_1h_usd=random.uniform(500, 120_000),
                price_change_5m_pct=random.uniform(-18, 55),
                top10_holder_pct=random.uniform(18, 75),
                buy_tax_pct=random.uniform(0, 12),
                sell_tax_pct=random.uniform(0, 14),
                contract_verified=random.random() > 0.18,
                mint_disabled=random.random() > 0.20,
                liquidity_locked=random.random() > 0.25,
                age_minutes=random.uniform(1, 180),
                market_cap_usd=random.uniform(25_000, 900_000),
            )


class OrderExecutor:
    """Execution boundary for paper trades or explicitly enabled live integrations."""

    def __init__(self, config: AppConfig):
        self.config = config

    def buy(self, token: TokenCandidate, size_usd: float) -> dict:
        if self.config.paper_mode:
            return {"mode": "paper", "status": "filled", "symbol": token.symbol, "size_usd": size_usd}
        raise RuntimeError("Live orders are disabled. Implement an authorized broker/API adapter and set allow_live_orders only after testing.")

    def sell(self, position: Position, reason: str, pnl_usd: float) -> dict:
        if self.config.paper_mode:
            return {"mode": "paper", "status": "filled", "symbol": position.symbol, "reason": reason, "pnl_usd": pnl_usd}
        raise RuntimeError("Live orders are disabled. Implement an authorized broker/API adapter and set allow_live_orders only after testing.")


class StrategyEngine:
    def __init__(self, config: AppConfig, provider: MarketDataProvider, executor: OrderExecutor | None = None):
        self.config = config
        self.provider = provider
        self.executor = executor or OrderExecutor(config)
        self.cooldowns: dict[str, float] = {}
        self.positions: dict[str, Position] = {}
        self.balance = config.virtual_balance_usd
        self.realized_pnl = 0.0
        self.log_path = Path(config.log_path)

    def score(self, token: TokenCandidate) -> tuple[int, list[str]]:
        risk = self.config.risk
        score = 0
        reasons: list[str] = []

        if token.contract_verified:
            score += 15
        else:
            reasons.append("unverified contract")
        if token.mint_disabled:
            score += 15
        else:
            reasons.append("mint authority may be active")
        if token.liquidity_locked:
            score += 15
        else:
            reasons.append("liquidity not locked")
        if token.liquidity_usd >= risk.min_liquidity_usd:
            score += 15
        else:
            reasons.append("low liquidity")
        if token.top10_holder_pct <= risk.max_top10_holder_pct:
            score += 15
        else:
            reasons.append("concentrated holders")
        if token.buy_tax_pct <= risk.max_buy_tax_pct and token.sell_tax_pct <= risk.max_sell_tax_pct:
            score += 10
        else:
            reasons.append("high transfer tax")

        watchlist = self.config.watchlist
        if watchlist.min_age_minutes <= token.age_minutes <= watchlist.max_age_minutes:
            score += 5
        else:
            reasons.append("outside launch-age window")
        if token.market_cap_usd <= watchlist.max_market_cap_usd:
            score += 5
        else:
            reasons.append("market cap above early-entry ceiling")

        volume_ratio = token.volume_5m_usd / max(token.volume_1h_usd / 12, 1)
        if (
            watchlist.min_volume_acceleration <= volume_ratio <= watchlist.max_volume_acceleration
            and watchlist.min_price_change_5m_pct <= token.price_change_5m_pct <= watchlist.max_price_change_5m_pct
        ):
            score += 15
        else:
            reasons.append("weak or overheated momentum")
        return min(score, 100), reasons

    def tick(self) -> list[str]:
        messages: list[str] = []
        for token in self.provider.fetch_candidates():
            score, reasons = self.score(token)
            self._audit("signal", {"token": token.__dict__, "score": score, "reasons": reasons})
            messages.append(f"{token.symbol}: score={score} price=${token.price_usd:.8f} reasons={', '.join(reasons) or 'ok'}")
            if self._can_enter(token, score):
                self._enter(token, score)
                messages.append(f"PAPER BUY {token.symbol}: ${self.config.risk.max_position_usd:.2f} at ${token.price_usd:.8f}")
        messages.extend(self._manage_positions())
        return messages

    def _can_enter(self, token: TokenCandidate, score: int) -> bool:
        risk = self.config.risk
        return (
            self.config.paper_mode
            and score >= risk.minimum_score
            and token.address not in self.positions
            and time.time() >= self.cooldowns.get(token.address, 0)
            and len(self.positions) < risk.max_open_positions
            and self.realized_pnl > -risk.daily_loss_limit_usd
            and self.balance >= risk.max_position_usd
        )

    def _enter(self, token: TokenCandidate, score: int) -> None:
        size = self.config.risk.max_position_usd
        self.executor.buy(token, size)
        self.balance -= size
        self.positions[token.address] = Position(
            symbol=token.symbol,
            address=token.address,
            entry_price=token.price_usd,
            size_usd=size,
            opened_at=now_iso(),
        )
        self._audit("paper_buy", {"symbol": token.symbol, "address": token.address, "score": score, "size_usd": size})

    def _manage_positions(self) -> list[str]:
        messages: list[str] = []
        for address, position in list(self.positions.items()):
            move_pct = random.uniform(-18, 45)
            if move_pct <= -self.config.risk.stop_loss_pct or move_pct >= self.config.risk.take_profit_pct:
                pnl = position.size_usd * move_pct / 100
                self.balance += position.size_usd + pnl
                self.realized_pnl += pnl
                del self.positions[address]
                self.cooldowns[address] = time.time() + self.config.risk.cooldown_seconds
                action = "STOP" if pnl < 0 else "TAKE PROFIT"
                self.executor.sell(position, action, pnl)
                self._audit("paper_sell", {"symbol": position.symbol, "pnl_usd": round(pnl, 4), "move_pct": round(move_pct, 2), "reason": action})
                messages.append(f"{action} {position.symbol}: pnl=${pnl:.2f} move={move_pct:.2f}%")
        return messages

    def _audit(self, event: str, payload: dict) -> None:
        row = {"ts": now_iso(), "event": event, **payload}
        with self.log_path.open("a", encoding="utf-8") as handle:
            handle.write(json.dumps(row, sort_keys=True) + "\n")


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def load_config(path: str) -> AppConfig:
    data = json.loads(Path(path).read_text(encoding="utf-8"))
    risk_data = data.pop("risk", {})
    trade_data = data.pop("trade", {})
    watchlist_data = data.pop("watchlist", {})
    if "paper_mode" in data:
        data["mode"] = "paper" if data.pop("paper_mode") else data.get("mode", "paper")
    return AppConfig(
        **data,
        trade=TradeConfig(**trade_data),
        risk=RiskConfig(**risk_data),
        watchlist=WatchlistConfig(**watchlist_data),
    )


class TradingGui:
    def __init__(self, root: tk.Tk, engine: StrategyEngine):
        self.root = root
        self.engine = engine
        self.running = threading.Event()
        self.worker: threading.Thread | None = None
        self.root.title("Axiom Professional Auto-Trader - Paper Mode")

        frame = ttk.Frame(root, padding=12)
        frame.grid(row=0, column=0, sticky="nsew")
        root.columnconfigure(0, weight=1)
        root.rowconfigure(0, weight=1)

        self.status = tk.StringVar(value="Stopped")
        self.start_balance = tk.StringVar(value=f"{self.engine.config.virtual_balance_usd:.2f}")
        ttk.Label(frame, textvariable=self.status).grid(row=0, column=0, columnspan=3, sticky="w")
        ttk.Label(frame, text="Starting balance USD").grid(row=1, column=0, sticky="w", pady=(8, 2))
        ttk.Entry(frame, textvariable=self.start_balance).grid(row=2, column=0, columnspan=2, sticky="ew", pady=(0, 8))
        ttk.Button(frame, text="Apply / Reset Balance", command=self.apply_balance).grid(row=2, column=2, sticky="ew", pady=(0, 8))
        ttk.Button(frame, text="Start", command=self.start).grid(row=3, column=0, sticky="ew", pady=8)
        ttk.Button(frame, text="Stop", command=self.stop).grid(row=3, column=1, sticky="ew", pady=8)
        ttk.Button(frame, text="Quit", command=self.quit).grid(row=3, column=2, sticky="ew", pady=8)

        self.output = tk.Text(frame, height=24, width=110)
        self.output.grid(row=4, column=0, columnspan=3, sticky="nsew")
        frame.rowconfigure(4, weight=1)
        for column in range(3):
            frame.columnconfigure(column, weight=1)

    def apply_balance(self) -> bool:
        if self.running.is_set():
            self._append("Stop the auto-trader before changing starting balance.")
            return False
        try:
            amount = max(1.0, float(self.start_balance.get()))
        except ValueError:
            self._append("Invalid starting balance. Enter a positive number.")
            return False
        self.engine.config.virtual_balance_usd = amount
        self.engine.balance = amount
        self.engine.realized_pnl = 0.0
        self.engine.positions.clear()
        self.engine.cooldowns.clear()
        self.engine._audit("paper_account_reset", {"starting_balance_usd": amount})
        self._append(f"Paper account reset with starting balance ${amount:.2f}")
        return True

    def start(self) -> None:
        if self.running.is_set():
            return
        if not self.apply_balance():
            return
        self.running.set()
        mode = "PAPER MODE" if self.engine.config.paper_mode else "LIVE MODE"
        self.status.set(f"Running in {mode}")
        self.worker = threading.Thread(target=self._loop, daemon=True)
        self.worker.start()

    def stop(self) -> None:
        self.running.clear()
        self.status.set("Stopped")

    def quit(self) -> None:
        self.stop()
        self.root.destroy()

    def _loop(self) -> None:
        while self.running.is_set():
            try:
                for message in self.engine.tick():
                    self.root.after(0, self._append, message)
            except Exception as exc:  # keep GUI alive and surface provider/config failures
                self.root.after(0, self._append, f"ERROR: {exc}")
            time.sleep(self.engine.config.poll_seconds)

    def _append(self, message: str) -> None:
        self.output.insert("end", f"[{now_iso()}] {message}\n")
        self.output.see("end")


def main() -> None:
    parser = argparse.ArgumentParser(description="Paper-trading meme-coin watcher GUI")
    parser.add_argument("--config", default="settings.example.json", help="Path to JSON config")
    args = parser.parse_args()
    config = load_config(args.config)
    engine = StrategyEngine(config, MarketDataProvider())
    root = tk.Tk()
    TradingGui(root, engine)
    root.mainloop()


if __name__ == "__main__":
    main()
