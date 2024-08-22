import React, { useContext, useEffect } from 'react';
import { useIntl } from 'react-intl';
import { useHistory } from 'react-router-dom';

import { FormTextInput, Form, Card, Button, Alert } from 'tabler-react';

import { useFormik } from 'formik';
import * as Yup from 'yup';
import _ from 'lodash';
import PandaBridge from 'pandasuite-bridge';

import * as ROUTES from '../../constants/routes';
import StandaloneFormPage from '../StandaloneFormPage';
import FirebaseBridgeContext from '../../FirebaseBridgeContext';

const SignIn = () => {
  const firebaseWithBridge = useContext(FirebaseBridgeContext);
  const intl = useIntl();
  const history = useHistory();

  const { bridge } = firebaseWithBridge || {};
  const { properties } = bridge || {};

  const formik = useFormik({
    initialValues: {},
    validationSchema: Yup.object({
      email: Yup.string().email('Invalid email address').required('Required'),
    }),
    onSubmit: (values) => {
      const { email, password } = values;
      const { auth } = firebaseWithBridge || {};

      auth
        .signInWithEmailAndPassword(email, password)
        .then(() => {
          formik.setSubmitting(false);
        })
        .catch((error) => {
          formik.setErrors({ global: error });
          formik.setSubmitting(false);
        });
    },
  });

  useEffect(() => {
    if (PandaBridge.isStudio) {
      PandaBridge.takeScreenshot();
    }
  });

  return (
    <StandaloneFormPage>
      <Form className="card" onSubmit={formik.handleSubmit}>
        <Card.Body className="p-6">
          <Card.Title RootComponent="div">
            {intl.formatMessage({ id: 'page.signin.form.title' })}
          </Card.Title>
          <FormTextInput
            name="email"
            label={intl.formatMessage({
              id: 'page.signin.form.input.email.label',
            })}
            placeholder={intl.formatMessage({
              id: 'page.signin.form.input.email.placeholder',
            })}
            onChange={formik.handleChange}
            onBlur={formik.handleBlur}
            value={formik.values && formik.values.email}
            error={formik.errors && formik.errors.email}
            disabled={formik.isSubmitting}
          />
          <Form.Group
            label={intl.formatMessage({
              id: 'page.signin.form.input.password.label',
            })}
          >
            <Form.Input
              name="password"
              type="password"
              placeholder={intl.formatMessage({
                id: 'page.signin.form.input.password.placeholder',
              })}
              onChange={formik.handleChange}
              onBlur={formik.handleBlur}
              value={formik.values && formik.values.password}
              error={formik.errors && formik.errors.password}
              disabled={formik.isSubmitting}
            />
          </Form.Group>
          {formik.errors && formik.errors.global && (
            <Alert type="danger" className="mt-6" isDismissible>
              {formik.errors.global.message}
              {formik.errors.global.code === 'auth/wrong-password' && (
                <>
                  <br />
                  <Button
                    link
                    className="p-0"
                    href="#"
                    onClick={() => {
                      history.push(
                        `${ROUTES.PASSWORD_FORGET}/${formik.values && formik.values.email}`,
                      );
                    }}
                  >
                    {intl.formatMessage({
                      id: 'page.signin.form.forgot.label',
                    })}
                  </Button>
                </>
              )}
            </Alert>
          )}
          <Form.Footer>
            <Button
              type="submit"
              color="primary"
              loading={formik.isSubmitting}
              disabled={
                formik.isSubmitting ||
                _.isEmpty(formik.values) ||
                !_.isEmpty(formik.errors)
              }
              block
            >
              {intl.formatMessage({ id: 'page.signin.form.button' })}
            </Button>
          </Form.Footer>
          {properties && properties.registration && (
            <div className="row row gutters-xs align-items-center mt-5">
              <div className="col col-auto">
                {intl.formatMessage({ id: 'page.signin.form.signup.label' })}
              </div>
              <Button
                link
                className="p-0"
                href="#"
                onClick={() => {
                  history.push(ROUTES.SIGN_UP);
                }}
              >
                {intl.formatMessage({ id: 'page.signin.form.signup.action' })}
              </Button>
            </div>
          )}
        </Card.Body>
      </Form>
    </StandaloneFormPage>
  );
};

export default SignIn;
