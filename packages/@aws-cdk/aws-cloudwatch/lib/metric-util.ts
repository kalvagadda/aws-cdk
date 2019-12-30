import { IMetric } from "./metric-types";

/**
 * Return the JSON structure which represents these metrics in a graph.
 *
 * Depending on the metric type (stat or expression), one `Metric` object
 * can render to multiple time series.
 *
 * - Top-level metrics will be rendered visibly, additionally added metrics will
 *   be rendered invisibly.
 * - IDs used in math expressions need to be either globally unique, or refer to the same
 *   metric object.
 *
 * This will be called by GraphWidget, no need for clients to call this.
 */
export function allMetricsGraphJson(left: IMetric[], right: IMetric[]): any[][] {
  // Add metrics to a set which will automatically expand them recursively,
  // making sure to retain conflicting the visible one on conflicting metrics objects.
  const mset = new MetricSet<string>();
  mset.addPrimary('left', ...left);
  mset.addPrimary('right', ...right);

  // Render all metrics from the set.
  return mset.entries.map(entry => metricGraphJson(entry.metric, entry.tag, entry.id));
}

function metricGraphJson(metric: IMetric, yAxis?: string, id?: string) {
  const config = metric.toMetricConfig();

  const ret: any[] = [];
  const options: any = { ...config.renderingProperties || {} };

  if (config.metricStat) {
    // Namespace and metric Name
    ret.push(
      config.metricStat.namespace,
      config.metricStat.metricName,
    );

    // Dimensions
    for (const dim of (config.metricStat.dimensions || [])) {
      ret.push(dim.name, dim.value);
    }

    // Metric attributes that are rendered to graph options
    if (config.metricStat.account) { options.accountId = config.metricStat.account; }
    if (config.metricStat.region) { options.region = config.metricStat.region; }
  } else if (config.mathExpression) {
    // Everything goes into the options object
    options.expression = config.mathExpression.expression;
  } else {
    throw new Error(`Metric object must have either 'metricStat' or 'mathExpression'`);
  }

  // Options
  if (!yAxis) { options.visible = false; }
  if (yAxis !== 'left') { options.yAxis = yAxis; }
  if (id) { options.id = id; }

  if (Object.keys(options).length !== 0) {
    ret.push(options);
  }
  return ret;
}

/**
 * A single metric in a MetricSet
 */
export interface MetricEntry<A> {
  /**
   * The metric object
   */
  metric: IMetric;

  /**
   * The tag, added if the object is a primary metric
   */
  tag?: A;

  /**
   * ID for this metric object
   */
  id?: string;
}

/**
 * Contain a set of metrics, expanding math expressions
 *
 * "Primary" metrics (added via a top-level call) can be tagged with an additional value.
 */
export class MetricSet<A> {
  private readonly metricKeys = new Map<IMetric, string>();
  private readonly metricMap = new Map<string, MetricEntry<A>>();

  /**
   * Add the given set of metrics to this set
   */
  public addPrimary(tag: A, ...metrics: IMetric[]) {
    for (const metric of metrics) {
      this.addOne(metric, tag);
    }
  }

  public get entries(): Array<MetricEntry<A>> {
    return Array.from(this.metricMap.values());
  }

  /**
   * Add a metric into the set
   *
   * If it already exists, either it must be getting a new id or the id must be
   * the same as before.
   *
   * It can be made visible, in which case the new "metric" object replaces the old
   * one (and the new ones "renderingPropertieS" will be honored instead of the old
   * one's).
   */
  private addOne(metric: IMetric, tag?: A, id?: string) {
    const key = this.keyOf(metric);

    // Record this one
    const existing = this.metricMap.get(key);
    if (existing) {
      // Set id on previously unnamed object
      if (id) {
        if (existing.id && existing.id !== id) {
          throw new Error(`Same id used for two metrics in the same graph: '${metric}' and '${existing.metric}'. Rename one.`);
        }
        existing.id = id;
      }
      // Replace object if invisible metric is being made visible (to use new one's renderingProperties).
      if (tag) {
        if (existing.tag && existing.tag !== tag) {
          throw new Error(`Same metric added on both axes: '${metric}' and '${existing.metric}'. Remove one.`);
        }
        // Replace object
        existing.tag = tag;
        existing.metric = metric;
      }
    } else {
      this.metricMap.set(key, { metric, tag, id });
    }

    // Recurse and add children
    const conf = metric.toMetricConfig();
    if (conf.mathExpression) {
      for (const [subId, subMetric] of Object.entries(conf.mathExpression.expressionMetrics)) {
        this.addOne(subMetric, undefined, subId);
      }
    }
  }

  /**
   * Cached version of metricKey
   */
  private keyOf(metric: IMetric) {
    const existing = this.metricKeys.get(metric);
    if (existing) { return existing; }

    const key = metricKey(metric);
    this.metricKeys.set(metric, key);
    return key;
  }
}

/**
 * Return a unique string representation for this metric.
 *
 * Can be used to determine as a hash key to determine if 2 Metric objects
 * represent the same metric. Excludes rendering properties.
 */
function metricKey(metric: IMetric) {
  const parts = new Array<string>();

  const conf = metric.toMetricConfig();
  if (conf.mathExpression) {
    parts.push(conf.mathExpression.expression);
    for (const id of Object.keys(conf.mathExpression.expressionMetrics).sort()) {
      parts.push(id);
      parts.push(metricKey(conf.mathExpression.expressionMetrics[id]));
    }
  }
  if (conf.metricStat) {
    parts.push(conf.metricStat.namespace);
    parts.push(conf.metricStat.metricName);
    for (const dim of conf.metricStat.dimensions || []) {
      parts.push(dim.name);
      parts.push(dim.value);
    }
    if (conf.metricStat.statistic) {
      parts.push(conf.metricStat.statistic);
    }
    if (conf.metricStat.period) {
      parts.push(`${conf.metricStat.period}`);
    }
    if (conf.metricStat.region) {
      parts.push(conf.metricStat.region);
    }
    if (conf.metricStat.account) {
      parts.push(conf.metricStat.account);
    }
  }

  return parts.join('|');
}