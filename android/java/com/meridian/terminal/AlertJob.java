package com.meridian.terminal;

import android.app.job.JobParameters;
import android.app.job.JobService;
import android.content.Context;

/** Android runs this about every 15 minutes while a price alert is waiting (see {@link Alerts}). */
public class AlertJob extends JobService {

    @Override
    public boolean onStartJob(final JobParameters params) {
        final Context app = getApplicationContext();
        new Thread(new Runnable() {
            @Override
            public void run() {
                try {
                    Alerts.check(app);
                } finally {
                    jobFinished(params, false);
                    Alerts.schedule(app); // stops the job once nothing is waiting
                }
            }
        }, "meridian-alerts").start();
        return true; // still working on the thread above
    }

    @Override
    public boolean onStopJob(JobParameters params) {
        return false; // the next period runs anyway
    }
}
