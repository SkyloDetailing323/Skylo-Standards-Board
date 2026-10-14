-- meta_ad_adsets(): which ad set (and campaign) each Meta ad is in, from its
-- latest ad_spend_daily row. reports.js ?type=ad_trends uses it to roll the
-- Ad health cards up to ad sets. Security invoker: service key only.
create or replace function public.meta_ad_adsets()
returns table(ad_id text, adset_id text, adset_name text, campaign_id text, campaign_name text)
language sql stable security invoker set search_path = public as $$
  select distinct on (ad_id) ad_id, adset_id, adset_name, campaign_id, campaign_name
  from ad_spend_daily where platform = 'meta' and ad_id <> ''
  order by ad_id, day desc
$$;
