CREATE TABLE IF NOT EXISTS public.player_auctions (
    itemid SERIAL PRIMARY KEY,
    sellerid INTEGER NOT NULL REFERENCES public.zmusers(userid),
    itemname TEXT NOT NULL,
    itemdesc TEXT,
    itemprice NUMERIC(10,2) NOT NULL,
    lastbid NUMERIC(10,2),
    status TEXT NOT NULL
);
